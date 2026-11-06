import { asUser } from "@klikgo/db/testing";
import { beforeEach, expect, it } from "vitest";
import { describeDb, failureOf, useRollbackTransaction } from "./support";

const CENTRE = { lat: 14.5547, lng: 121.0244 };

/** Phase 6: the store confirmation SLA, live-update topics and the notification queue. */
describeDb("order lifecycle: SLA escalation, realtime topics, notification queue", () => {
  const { db, fx } = useRollbackTransaction();
  let customer: string;
  let owner: string;
  let coordinator: string;
  let merchant: string;
  let zone: string;

  beforeEach(async () => {
    customer = await fx().user("SLA Customer");
    owner = await fx().user("SLA Owner");
    zone = await fx().zone({ name: "SLA Zone", centre: CENTRE });
    coordinator = await fx().user("SLA Coordinator", [{ role: "coordinator", zoneId: zone }]);
    merchant = await fx().merchant({
      zoneId: zone,
      ownerId: owner,
      name: "SLA Karinderya",
      location: CENTRE,
    });
  });

  /** A cash order that reached the store `seconds` ago. */
  async function waiting(seconds: number): Promise<string> {
    const id = await fx().order({
      customerId: customer,
      merchantId: merchant,
      zoneId: zone,
      dropoff: CENTRE,
    });
    await db().query(
      "update public.orders set placed_at = now() - make_interval(secs => $2) where id = $1",
      [id, seconds],
    );
    return id;
  }

  async function escalate(): Promise<{ texted: number; flagged: number; cancelled: number }> {
    const { rows } = await db().query<{
      r: { texted: number; flagged: number; cancelled: number };
    }>("select private.escalate_merchant_sla() as r");
    return rows[0]?.r ?? { texted: -1, flagged: -1, cancelled: -1 };
  }

  async function queued(orderId: string) {
    const { rows } = await db().query<{
      user_id: string;
      channel: string;
      template: string;
      status: string;
    }>(
      `select user_id, channel::text, template, status from public.notifications
        where order_id = $1 order by template, channel`,
      [orderId],
    );
    return rows;
  }

  async function order(orderId: string) {
    const { rows } = await db().query<{
      status: string;
      cancel_reason: string | null;
      sla_sms_at: Date | null;
      sla_flagged_at: Date | null;
    }>(
      "select status::text, cancel_reason, sla_sms_at, sla_flagged_at from public.orders where id = $1",
      [orderId],
    );
    return rows[0];
  }

  it("does nothing in the first minute", async () => {
    const fresh = await waiting(30);
    await escalate();
    expect(await queued(fresh)).toEqual([]);
    expect((await order(fresh))?.sla_sms_at).toBeNull();
  });

  it("texts the store once after a minute", async () => {
    const id = await waiting(61);
    await escalate();
    await escalate();
    expect(await queued(id)).toEqual([
      { user_id: owner, channel: "sms", template: "merchant_order_waiting", status: "queued" },
    ]);
    expect((await order(id))?.sla_sms_at).not.toBeNull();
  });

  it("alerts the zone's coordinators once after two minutes", async () => {
    const id = await waiting(121);
    await escalate();
    await escalate();
    const alerts = (await queued(id)).filter((n) => n.template === "order_unacknowledged");
    expect(alerts).toEqual([
      {
        user_id: coordinator,
        channel: "in_app",
        template: "order_unacknowledged",
        status: "queued",
      },
      { user_id: coordinator, channel: "push", template: "order_unacknowledged", status: "queued" },
    ]);
    expect((await order(id))?.status).toBe("placed");
  });

  it("cancels after three minutes as the system, releases the promo and tells the customer", async () => {
    const id = await waiting(181);
    const { rows: promo } = await db().query<{ id: string }>(
      `insert into public.promos (code, type, discount_centavos, starts_at, ends_at)
       values ('SLA' || upper(substr(md5(random()::text), 1, 6)), 'fixed_off', 5000, now(), now() + interval '1 day')
       returning id`,
    );
    await db().query(
      "insert into public.promo_redemptions (promo_id, user_id, order_id, discount_centavos) values ($1, $2, $3, 5000)",
      [promo[0]?.id, customer, id],
    );
    expect((await escalate()).cancelled).toBeGreaterThanOrEqual(1);
    expect(await order(id)).toMatchObject({
      status: "cancelled",
      cancel_reason: "merchant_timeout",
    });
    const { rows: events } = await db().query<{
      to_status: string;
      actor_id: string | null;
      meta: unknown;
    }>(
      "select to_status::text, actor_id, meta from public.order_events where order_id = $1 order by id desc limit 1",
      [id],
    );
    expect(events[0]).toEqual({
      to_status: "cancelled",
      actor_id: null,
      meta: { reason: "merchant_timeout", by: "system" },
    });
    const { rows: left } = await db().query(
      "select 1 from public.promo_redemptions where order_id = $1",
      [id],
    );
    expect(left).toHaveLength(0);
    expect((await queued(id)).filter((n) => n.template === "order_store_timeout")).toEqual([
      { user_id: customer, channel: "in_app", template: "order_store_timeout", status: "queued" },
      { user_id: customer, channel: "push", template: "order_store_timeout", status: "queued" },
    ]);
  });

  it("leaves orders the store already accepted alone", async () => {
    const id = await waiting(300);
    await fx().setStatus(id, "accepted", { id: owner, role: "merchant_owner" });
    await escalate();
    expect((await order(id))?.status).toBe("accepted");
    expect(await queued(id)).toEqual([]);
  });

  it("can be switched off with the merchant_sla flag", async () => {
    const id = await waiting(500);
    await db().query("update public.feature_flags set enabled = false where key = 'merchant_sla'");
    expect(await escalate()).toEqual({ enabled: false });
    expect((await order(id))?.status).toBe("placed");
  });

  it("runs the escalation and the app jobs every 30 seconds", async () => {
    const { rows } = await db().query<{ jobname: string; schedule: string }>(
      "select jobname, schedule from cron.job where jobname in ('merchant-sla', 'app-jobs') order by jobname",
    );
    expect(rows).toEqual([
      { jobname: "app-jobs", schedule: "30 seconds" },
      { jobname: "merchant-sla", schedule: "30 seconds" },
    ]);
    // Without the Vault secrets (local, CI) calling the app is a no-op.
    const { rows: call } = await db().query<{ r: string | null }>(
      "select private.run_app_jobs() as r",
    );
    expect(call[0]?.r).toBeNull();
  });

  it("requires a reason to reject, and still changes status when a live update cannot be sent", async () => {
    const id = await waiting(10);
    const err = await failureOf(db(), () =>
      db().query("update public.orders set status = 'rejected' where id = $1", [id]),
    );
    expect(err).toMatch(/orders_reject_has_reason/);
    await db().query(
      "update public.orders set status = 'rejected', reject_reason = 'Out of rice' where id = $1",
      [id],
    );
    expect((await order(id))?.status).toBe("rejected");
  });

  it("lets only the order's people listen on its live-update topics", async () => {
    const id = await waiting(10);
    const stranger = await fx().user("SLA Stranger");
    const follows = async (userId: string, topic: string, aal = "aal1"): Promise<boolean> => {
      await db().query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: "authenticated", aal }),
      ]);
      await db().query("set local role authenticated");
      try {
        const { rows } = await db().query<{ ok: boolean }>(
          "select private.can_follow_topic($1) as ok",
          [topic],
        );
        return rows[0]?.ok ?? false;
      } finally {
        await db().query("reset role");
      }
    };
    expect(await follows(customer, `order:${id}`)).toBe(true);
    expect(await follows(stranger, `order:${id}`)).toBe(false);
    expect(await follows(owner, `order:${id}`)).toBe(false);
    expect(await follows(owner, `order:${id}`, "aal2")).toBe(true);
    expect(await follows(owner, `merchant:${merchant}`, "aal2")).toBe(true);
    expect(await follows(owner, `merchant:${merchant}`)).toBe(false);
    expect(await follows(customer, `merchant:${merchant}`, "aal2")).toBe(false);
    expect(await follows(coordinator, `order:${id}`, "aal2")).toBe(true);
    expect(await follows(customer, "order:not-a-uuid")).toBe(false);
    expect(await follows(customer, `rider:${id}`)).toBe(false);
    const { rows } = await db().query<{ policyname: string; cmd: string }>(
      "select policyname, cmd from pg_policies where schemaname = 'realtime' and tablename = 'messages'",
    );
    // Clients may only listen: there is no insert policy, so they cannot broadcast.
    expect(rows).toEqual([{ policyname: "klikgo_follow_order_topics", cmd: "SELECT" }]);
  });

  it("lets a customer read only their own notifications", async () => {
    const id = await waiting(181);
    await escalate();
    const mine = await asUser(
      db(),
      customer,
      async () =>
        (
          await db().query<{ id: string }>(
            "select id from public.notifications where order_id = $1",
            [id],
          )
        ).rows,
    );
    expect(mine).toHaveLength(2);
    const theirs = await asUser(
      db(),
      owner,
      async () =>
        (
          await db().query<{ id: string }>(
            "select id from public.notifications where user_id = $1",
            [customer],
          )
        ).rows,
    );
    expect(theirs).toHaveLength(0);
  });
});
