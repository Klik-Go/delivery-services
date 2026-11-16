import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { weekOf } from "@klikgo/core";
import { Given, Then, When } from "@cucumber/cucumber";
import type { ApiClient, ApiResponse } from "../support/api-client";
import { signedInStaff } from "../support/staff-session";
import type { KlikWorld } from "../support/world";

const RIDERS: Readonly<Record<string, string>> = {
  Rico: "5eed0000-0000-4000-8000-000000000201",
  Rosa: "5eed0000-0000-4000-8000-000000000202",
};
const BOM = String.fromCharCode(0xfeff);

function data<T>(response: ApiResponse): T {
  const json = response.json as { data?: T } | undefined;
  assert.ok(json?.data !== undefined, `No data (${String(response.status)}): ${response.bodyText}`);
  return json.data;
}

function admin(world: KlikWorld): ApiClient {
  assert.ok(world.ops.admin, "No admin signed in");
  return world.ops.admin.client;
}

function rider(name: string): string {
  const id = RIDERS[name];
  assert.ok(id, `No seeded rider ${name}`);
  return id;
}

async function storeId(world: KlikWorld, name: string): Promise<string> {
  const [row] = await world.db.query<{ id: string }>(
    "select id from public.merchants where name = $1",
    [name],
  );
  assert.ok(row, `No store ${name}`);
  return row.id;
}

/**
 * A finished week before every ledger row and order (earlier runs included), so its ledger holds
 * only this scenario's rows and its settlement is this scenario's alone.
 */
async function scenarioWeek(world: KlikWorld): Promise<NonNullable<KlikWorld["finance"]["week"]>> {
  if (world.finance.week) return world.finance.week;
  const [row] = await world.db.query<{ at: Date | null }>(
    `select least((select min(created_at) from public.ledger_entries),
                  (select min(delivered_at) from public.orders),
                  (select min(period_start)::timestamptz from public.settlement_runs)) as at`,
  );
  const week = weekOf(new Date((row?.at ?? new Date()).getTime() - 14 * 86_400_000));
  world.finance.week = week;
  return week;
}

/** One balanced ledger transaction, dated inside the scenario's week. */
async function book(
  world: KlikWorld,
  lines: readonly [
    account: string,
    party: string,
    partyId: string | null,
    debit: number,
    credit: number,
  ][],
  orderId: string | null = null,
): Promise<void> {
  const week = await scenarioWeek(world);
  const at = new Date(week.startsAt.getTime() + 2 * 86_400_000);
  const txn = randomUUID();
  await world.db.query("begin");
  try {
    for (const [account, party, partyId, debit, credit] of lines) {
      await world.db.query(
        `insert into public.ledger_entries (txn_id, account, party_type, party_id, debit_centavos, credit_centavos, order_id, memo, created_at)
         values ($1, $2::public.ledger_account, $3::public.ledger_party, $4, $5, $6, $7, 'scenario', $8)`,
        [txn, account, party, partyId, debit, credit, orderId, at],
      );
    }
    await world.db.query("commit");
  } catch (error) {
    await world.db.query("rollback");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The week's money
// ---------------------------------------------------------------------------

Given(
  "a finished week in which {string} earned {int} and {int} centavos from two orders",
  async function (this: KlikWorld, store: string, first: number, second: number) {
    const id = await storeId(this, store);
    for (const amount of [first, second]) {
      await book(this, [
        ["customer_deposits", "customer", randomUUID(), amount + 5000, 0],
        ["merchant_payable", "merchant", id, 0, amount],
        ["platform_revenue", "platform", null, 0, 5000],
      ]);
    }
  },
);

Given(
  "rider {string} earned {int} centavos on online orders that week",
  async function (this: KlikWorld, name: string, earned: number) {
    await book(this, [
      ["customer_deposits", "customer", randomUUID(), earned, 0],
      ["rider_payable", "rider", rider(name), 0, earned],
    ]);
  },
);

Given(
  "a finished week in which rider {string} collected {int} centavos in cash and earned {int} centavos",
  async function (this: KlikWorld, name: string, cash: number, earned: number) {
    await book(this, [
      ["rider_cash_on_hand", "rider", rider(name), cash, 0],
      ["rider_payable", "rider", rider(name), 0, earned],
      ["platform_revenue", "platform", null, 0, cash - earned],
    ]);
  },
);

Given(
  "{string} is paid by GCash to {string} {word}",
  async function (this: KlikWorld, store: string, name: string, number: string) {
    await this.db.query(
      `insert into public.payout_accounts (party_type, party_id, method, account_name, account_number)
       values ('merchant', $1, 'gcash', $2, $3)
       on conflict (party_type, party_id) do update set method = 'gcash', account_name = $2, account_number = $3, bank_name = null`,
      [await storeId(this, store), name, number],
    );
  },
);

When("the admin settles that week", async function (this: KlikWorld) {
  const week = await scenarioWeek(this);
  this.lastResponse = await admin(this).post("/api/admin/finance/settle", { week: week.start });
  assert.equal(this.response().status, 201, this.response().bodyText);
});

interface Payout {
  id: string;
  partyId: string;
  partyName: string;
  earningsCentavos: number;
  cashNettedCentavos: number;
  amountCentavos: number;
  status: string;
  reference: string | null;
}

async function payouts(world: KlikWorld): Promise<Payout[]> {
  const week = await scenarioWeek(world);
  return data<{ payouts: Payout[] }>(
    await admin(world).request("GET", `/api/admin/finance/payouts?week=${week.start}`),
  ).payouts;
}

async function payoutOf(world: KlikWorld, partyId: string): Promise<Payout> {
  const found = (await payouts(world)).find((p) => p.partyId === partyId);
  assert.ok(found, `No payout for ${partyId}`);
  return found;
}

Then(
  "{string} is to be paid {int} centavos with {int} order lines",
  async function (this: KlikWorld, store: string, amount: number, lines: number) {
    const payout = await payoutOf(this, await storeId(this, store));
    assert.equal(payout.amountCentavos, amount);
    assert.equal(payout.status, "draft");
    const [count] = await this.db.query<{ n: number }>(
      "select count(*)::int as n from public.payout_lines where payout_id = $1 and kind = 'order'",
      [payout.id],
    );
    assert.equal(count?.n, lines);
  },
);

Then(
  "{string} is to be paid {int} centavos",
  async function (this: KlikWorld, name: string, amount: number) {
    assert.equal((await payoutOf(this, rider(name))).amountCentavos, amount);
  },
);

Then(
  "every payout equals what the ledger moved out of the payable accounts",
  async function (this: KlikWorld) {
    for (const payout of await payouts(this)) {
      const [row] = await this.db.query<{ moved: string }>(
        `select coalesce(sum(credit_centavos), 0)::text as moved from public.ledger_entries
        where account = 'payouts_due' and party_id = $1 and memo = 'Weekly payout approved'
          and created_at >= now() - interval '10 minutes'`,
        [payout.partyId],
      );
      assert.ok(
        Number(row?.moved) >= payout.amountCentavos,
        `${payout.partyName}: ${row?.moved ?? "none"}`,
      );
      const [lines] = await this.db.query<{ total: string }>(
        "select sum(amount_centavos)::text as total from public.payout_lines where payout_id = $1",
        [payout.id],
      );
      assert.equal(Number(lines?.total), payout.amountCentavos, `${payout.partyName} lines`);
    }
  },
);

Then(
  "settling the same week again is refused with {string}",
  async function (this: KlikWorld, message: string) {
    const week = await scenarioWeek(this);
    const again = await admin(this).post("/api/admin/finance/settle", { week: week.start });
    assert.equal(again.status, 409, again.bodyText);
    assert.equal((again.json as { error: { message: string } }).error.message, message);
  },
);

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

function cleanCsv(text: string): string[] {
  assert.ok(text.startsWith(BOM), "No UTF-8 byte-order mark");
  assert.ok(text.endsWith("\r\n"), "Lines must end with CRLF");
  return text.slice(1).split("\r\n").filter(Boolean);
}

When("the admin downloads the transfer list", async function (this: KlikWorld) {
  const week = await scenarioWeek(this);
  const response = await admin(this).request(
    "GET",
    `/api/admin/finance/payouts/export?week=${week.start}`,
  );
  assert.equal(response.status, 200, response.bodyText);
  assert.match(response.headers.get("content-type") ?? "", /^text\/csv; charset=utf-8/);
  assert.match(
    response.headers.get("content-disposition") ?? "",
    /attachment; filename="klikgo-payouts-/,
  );
  this.finance.csv = response.bodyText;
});

Then(
  "the CSV opens cleanly in a spreadsheet and lists {string} for {word}",
  function (this: KlikWorld, name: string, amount: string) {
    const lines = cleanCsv(this.finance.csv ?? "");
    assert.equal(
      lines[0],
      '"Payout ID","Type","Name","Method","Account name","Account number","Bank","Amount (PHP)","Reference"',
    );
    const row = lines.find((l) => l.includes(`"${name}"`));
    assert.ok(row, `${name} is not in the transfer list`);
    assert.ok(
      row.endsWith(`,"GCash","Nena Santos","09170000011","",${amount},""`),
      `unexpected transfer row: ${row}`,
    );
  },
);

When(
  /^the admin marks the "([^"]+)" payout (paid with reference|failed because) "([^"]+)"$/,
  async function (this: KlikWorld, store: string, how: string, text: string) {
    const payout = await payoutOf(this, await storeId(this, store));
    this.finance.payoutId = payout.id;
    this.lastResponse = how.startsWith("paid")
      ? await admin(this).post(`/api/admin/finance/payouts/${payout.id}/paid`, { reference: text })
      : await admin(this).post(`/api/admin/finance/payouts/${payout.id}/failed`, { reason: text });
    assert.equal(this.response().status, 200, this.response().bodyText);
  },
);

Then(
  "marking it paid again is refused with {string}",
  async function (this: KlikWorld, message: string) {
    const again = await admin(this).post(
      `/api/admin/finance/payouts/${this.finance.payoutId ?? ""}/paid`,
      {
        reference: "GC-AGAIN",
      },
    );
    assert.equal(again.status, 409, again.bodyText);
    assert.equal((again.json as { error: { message: string } }).error.message, message);
  },
);

async function owner(world: KlikWorld, store: string): Promise<{ client: ApiClient; id: string }> {
  const id = await storeId(world, store);
  const signed = await signedInStaff(world, "merchant_owner", { merchantId: id });
  return { client: signed.client, id };
}

Then(
  "the owner of {string} sees that week's statement as paid with reference {string}",
  async function (this: KlikWorld, store: string, reference: string) {
    const { client, id } = await owner(this, store);
    this.finance.owner = { client, storeId: id };
    const page = data<{ payouts: Payout[] }>(
      await client.request("GET", `/api/merchant/${id}/payouts`),
    );
    const mine = page.payouts.find((p) => p.id === this.finance.payoutId);
    assert.ok(mine, "The statement is missing");
    assert.equal(mine.status, "paid");
    assert.equal(mine.reference, reference);
  },
);

Then(
  "the owner can download the statement as a CSV totalling {word}",
  async function (this: KlikWorld, total: string) {
    assert.ok(this.finance.owner, "No owner signed in");
    const { client, storeId: id } = this.finance.owner;
    const response = await client.request(
      "GET",
      `/api/merchant/${id}/payouts/${this.finance.payoutId ?? ""}/export`,
    );
    assert.equal(response.status, 200, response.bodyText);
    const lines = cleanCsv(response.bodyText);
    assert.equal(lines[0], '"Date (Manila)","Order","Description","Amount (PHP)"');
    assert.equal(lines.at(-1), `"","","Total paid",${total}`);
  },
);

Then(
  "{string} is owed {int} centavos again",
  async function (this: KlikWorld, store: string, amount: number) {
    // The failed payout's money went back to the store's payable account (paid next week).
    const [row] = await this.db.query<{ credit_centavos: number }>(
      `select credit_centavos from public.ledger_entries
      where account = 'merchant_payable' and party_id = $1 and memo = 'Payout failed; paid next week'
      order by id desc limit 1`,
      [await storeId(this, store)],
    );
    assert.equal(row?.credit_centavos, amount);
    const payout = await payoutOf(this, await storeId(this, store));
    assert.equal(payout.status, "failed");
  },
);

// ---------------------------------------------------------------------------
// Cash on delivery
// ---------------------------------------------------------------------------

Then(
  "{string} is paid {int} centavos with {int} centavos of cash netted",
  async function (this: KlikWorld, name: string, amount: number, netted: number) {
    const payout = await payoutOf(this, rider(name));
    assert.equal(payout.amountCentavos, amount);
    assert.equal(payout.cashNettedCentavos, netted);
    assert.equal(payout.status, amount === 0 ? "paid" : "draft");
  },
);

Then(
  "{string} still holds {int} centavos of that week's cash",
  async function (this: KlikWorld, name: string, held: number) {
    // Cash collected up to the week's end, less what this week's settlement netted.
    const week = await scenarioWeek(this);
    const [row] = await this.db.query<{ held: string }>(
      `select sum(debit_centavos - credit_centavos)::text as held from public.ledger_entries
        where account = 'rider_cash_on_hand' and party_id = $1 and created_at < $2`,
      [rider(name), week.endsAt],
    );
    const payout = await payoutOf(this, rider(name));
    assert.equal(Number(row?.held) - payout.cashNettedCentavos, held);
  },
);

async function cashHeld(world: KlikWorld, name: string): Promise<number> {
  const [row] = await world.db.query<{ held: string | null }>(
    `select sum(debit_centavos - credit_centavos)::text as held from public.ledger_entries
      where account = 'rider_cash_on_hand' and party_id = $1`,
    [rider(name)],
  );
  return Number(row?.held ?? 0);
}

Given(
  "rider {string} holds at least {int} centavos of cash",
  async function (this: KlikWorld, name: string, amount: number) {
    const now = await cashHeld(this, name);
    if (now < amount) {
      const txn = randomUUID();
      await this.db.query("begin");
      await this.db.query(
        `insert into public.ledger_entries (txn_id, account, party_type, party_id, debit_centavos, credit_centavos, memo)
       values ($1, 'rider_cash_on_hand', 'rider', $2, $3, 0, 'scenario'), ($1, 'platform_revenue', 'platform', null, 0, $3, 'scenario')`,
        [txn, rider(name), amount - now],
      );
      await this.db.query("commit");
    }
    this.finance.cashBefore = await cashHeld(this, name);
  },
);

When(
  "the coordinator records {int} centavos handed in by {string} with reference {string}",
  async function (this: KlikWorld, amount: number, name: string, reference: string) {
    assert.ok(this.ops.coordinator);
    this.lastResponse = await this.ops.coordinator.client.post("/api/admin/finance/cash", {
      riderId: rider(name),
      amountCentavos: amount,
      reference,
    });
    assert.equal(this.response().status, 201, this.response().bodyText);
  },
);

Then(
  "{string} holds {int} centavos less cash",
  async function (this: KlikWorld, name: string, less: number) {
    assert.equal(await cashHeld(this, name), (this.finance.cashBefore ?? 0) - less);
    const holder = data<{ cashHeldCentavos: number }>(this.response());
    assert.equal(holder.cashHeldCentavos, (this.finance.cashBefore ?? 0) - less);
  },
);

Then(
  "recording more than {string} holds is refused",
  async function (this: KlikWorld, name: string) {
    assert.ok(this.ops.coordinator);
    const response = await this.ops.coordinator.client.post("/api/admin/finance/cash", {
      riderId: rider(name),
      amountCentavos: (await cashHeld(this, name)) + 100,
      reference: "Too much",
    });
    assert.equal(response.status, 400, response.bodyText);
  },
);

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

Given(
  "a finished week with 2 delivered orders in Makati: one cash order and one paid online",
  async function (this: KlikWorld) {
    const week = await scenarioWeek(this);
    const deliveredAt = new Date(week.startsAt.getTime() + 2 * 86_400_000);
    const [store] = await this.db.query<{ id: string; zone_id: string }>(
      "select id, zone_id from public.merchants where name = $1",
      ["Kape't Tinapay"],
    );
    assert.ok(store);
    const [customer] = await this.db.query<{ id: string }>(
      "select id from public.profiles where phone = '+639170000031'",
    );
    for (const method of ["cod", "gcash"]) {
      const inserted: { id: string }[] = await this.db.query<{ id: string }>(
        `insert into public.orders (customer_id, merchant_id, zone_id, status, payment_method, subtotal_centavos,
                                    delivery_fee_centavos, total_centavos, address_snapshot, dropoff, payment_status)
         values ($1, $2, $3, 'placed', $4::public.payment_method, 24000, 4000, 28000,
                 '{"label":"Home","landmark":"Gate","contact_phone":"+639170000031"}',
                 'SRID=4326;POINT(121.0244 14.5547)'::extensions.geography, 'paid')
         returning id`,
        [customer?.id, store.id, store.zone_id, method],
      );
      const order = inserted[0];
      assert.ok(order);
      await this.db.query("begin");
      await this.db.query("select set_config('klikgo.actor_role', '', true)");
      for (const status of ["accepted", "preparing", "ready", "picked_up", "delivered"]) {
        await this.db.query(
          `update public.orders set status = $2::public.order_status,
                  rider_id = case when $2 = 'picked_up' then $3::uuid else rider_id end where id = $1`,
          [order.id, status, rider("Rosa")],
        );
      }
      await this.db.query("update public.orders set delivered_at = $2 where id = $1", [
        order.id,
        deliveredAt,
      ]);
      await this.db.query("commit");
      await book(
        this,
        [
          [
            method === "cod" ? "rider_cash_on_hand" : "customer_deposits",
            method === "cod" ? "rider" : "customer",
            method === "cod" ? rider("Rosa") : (customer?.id ?? null),
            28000,
            0,
          ],
          ["merchant_payable", "merchant", store.id, 0, 17000],
          ["rider_payable", "rider", rider("Rosa"), 0, 4000],
          ["platform_revenue", "platform", null, 0, 7000],
        ],
        order.id,
      );
    }
  },
);

When("the admin opens that week's report", async function (this: KlikWorld) {
  const week = await scenarioWeek(this);
  this.lastResponse = await admin(this).request(
    "GET",
    `/api/admin/finance/report?week=${week.start}`,
  );
  assert.equal(this.response().status, 200, this.response().bodyText);
});

Then(
  "Makati shows {int} orders, a GMV of {int} centavos, a {int}% take rate and a {int}% cash share",
  function (this: KlikWorld, orders: number, gmv: number, take: number, cash: number) {
    const report = data<{
      zones: {
        zoneName: string;
        deliveredOrders: number;
        gmvCentavos: number;
        takeRateBps: number;
        codShareBps: number;
      }[];
    }>(this.response());
    const makati = report.zones.find((z) => z.zoneName.startsWith("Makati"));
    assert.ok(makati, "No Makati row");
    assert.deepEqual(
      [makati.deliveredOrders, makati.gmvCentavos, makati.takeRateBps, makati.codShareBps],
      [orders, gmv, take * 100, cash * 100],
    );
  },
);

Then("the report CSV opens cleanly in a spreadsheet", async function (this: KlikWorld) {
  const week = await scenarioWeek(this);
  const response = await admin(this).request(
    "GET",
    `/api/admin/finance/report/export?week=${week.start}`,
  );
  const lines = cleanCsv(response.bodyText);
  assert.match(lines[0] ?? "", /^"Zone","Delivered orders","GMV \(PHP\)"/);
  assert.ok(
    lines.some((l) => /^"Makati City",2,560\.00,140\.00,"25\.00%"/.test(l)),
    lines.join("\n"),
  );
});

Then(
  "the ledger CSV lists the week's rows with account codes from the chart of accounts",
  async function (this: KlikWorld) {
    const week = await scenarioWeek(this);
    const response = await admin(this).request(
      "GET",
      `/api/admin/finance/ledger/export?week=${week.start}`,
    );
    const lines = cleanCsv(response.bodyText);
    assert.equal(lines.length, 1 + 8);
    assert.ok(
      lines.some((l) =>
        l.includes(
          '"4000","Commission and delivery fee revenue (net of rider pay)","Income","platform_revenue"',
        ),
      ),
    );
  },
);

Then("coordinators cannot open reports", async function (this: KlikWorld) {
  const week = await scenarioWeek(this);
  const [zone] = await this.db.query<{ id: string }>(
    "select id from public.zones where slug = 'makati'",
  );
  const coordinator = await signedInStaff(this, "coordinator", { zoneId: zone?.id ?? "" });
  const response = await coordinator.client.request(
    "GET",
    `/api/admin/finance/report?week=${week.start}`,
  );
  assert.equal(response.status, 403, response.bodyText);
});
