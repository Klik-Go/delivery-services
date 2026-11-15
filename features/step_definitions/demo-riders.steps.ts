import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { After, Given, Then, When } from "@cucumber/cucumber";
import { DEMO_STORES } from "../../scripts/demo/demo-data";
import { DEMO_RIDERS } from "../../scripts/demo/demo-riders";
import { ApiClient, type ApiResponse } from "../support/api-client";
import { signInWithPhone } from "../support/phone-session";
import { signedInStaff } from "../support/staff-session";
import { randomIp } from "../support/supabase-test-auth";
import { BASE_URL, type KlikWorld } from "../support/world";

const run = promisify(execFile);
const ZONES = ["makati", "san-fernando-pampanga", "san-marcelino-zambales"] as const;

interface ReviewItem {
  readonly type: string;
  readonly state: string;
  readonly document: { readonly id: string } | null;
}
interface Review {
  readonly id: string;
  readonly name: string | null;
  readonly status: string;
  readonly statusReason: string | null;
  readonly checklist: readonly ReviewItem[];
}

function data<T>(response: ApiResponse): T {
  const json = response.json as { data?: T } | undefined;
  assert.ok(json?.data !== undefined, `No data (${String(response.status)}): ${response.bodyText}`);
  return json.data;
}

async function demoRiders(world: KlikWorld, action: "load" | "hide"): Promise<void> {
  const { stdout } = await run("node", ["--import", "tsx", "scripts/demo-riders.ts"], {
    env: { ...process.env, DEMO_ACTION: action },
  });
  world.auth.scriptOutput = stdout;
}

/** An admin signed in to the console (one per scenario). */
async function consoleClient(world: KlikWorld): Promise<ApiClient> {
  world.ops.admin ??= await signedInStaff(world, "admin");
  return world.ops.admin.client;
}

async function queue(world: KlikWorld, filter: string): Promise<Review[]> {
  return data<Review[]>(
    await (await consoleClient(world)).request("GET", `/api/admin/riders?filter=${filter}`),
  );
}

function demo(name: string): (typeof DEMO_RIDERS)[number] {
  const rider = DEMO_RIDERS.find((r) => r.fullName === name);
  assert.ok(rider, `No demo rider ${name}`);
  return rider;
}

async function review(world: KlikWorld, filter: string, name: string): Promise<Review> {
  const found = (await queue(world, filter)).find((r) => r.id === demo(name).id);
  assert.ok(found, `${name} is not under "${filter}"`);
  return found;
}

// Other scenarios dispatch to the seeded riders only: always take the demo riders off again.
After({ tags: "@demo-riders" }, async function (this: KlikWorld) {
  await demoRiders(this, "hide");
});

When(/^the owner loads the demo riders(?: again)?$/, async function (this: KlikWorld) {
  await demoRiders(this, "load");
});

When("the owner hides the demo riders", async function (this: KlikWorld) {
  await demoRiders(this, "hide");
});

Then(
  "every launch zone has a demo rider who is approved, online and placed near a demo store",
  async function (this: KlikWorld) {
    for (const zone of ZONES) {
      const stores = DEMO_STORES.filter((s) => s.zoneSlug === zone);
      const rows = await this.db.query<{ id: string; nearest_m: number }>(
        `select r.id,
                (select min(extensions.st_distance(l.location,
                   extensions.st_setsrid(extensions.st_makepoint(s.lng, s.lat), 4326)::extensions.geography))
                   from jsonb_to_recordset($2::jsonb) as s(lat float8, lng float8))::float8 as nearest_m
           from public.riders r
           join public.zones z on z.id = r.zone_id
           join public.rider_locations l on l.rider_id = r.id
          where r.id::text like 'de400000-%' and z.slug = $1 and r.status = 'active' and r.is_online
            and l.updated_at > now() - interval '2 minutes'`,
        [zone, JSON.stringify(stores.map((s) => ({ lat: s.lat, lng: s.lng })))],
      );
      assert.ok(rows.length >= 1, `No online demo rider in ${zone}`);
      for (const row of rows)
        assert.ok(row.nearest_m < 1000, `${row.id} is ${row.nearest_m} m away`);
    }
  },
);

Then(
  "the KYC queue has the demo applicants, each with all five placeholder documents",
  async function (this: KlikWorld) {
    const pending = await queue(this, "pending");
    const applicants = DEMO_RIDERS.filter((r) => r.state === "applicant");
    assert.ok(applicants.length >= 2);
    for (const applicant of applicants) {
      const found = pending.find((r) => r.id === applicant.id);
      assert.ok(found, `${applicant.fullName} is not in the KYC queue`);
      assert.equal(found.name, applicant.fullName);
      assert.deepEqual(
        found.checklist.filter((item) => item.state === "missing").map((item) => item.type),
        [],
      );
    }
    // The documents open through the 60-second link and are labelled placeholders.
    const first = pending.find((r) => r.id === applicants[0]?.id);
    const documentId = first?.checklist[0]?.document?.id ?? "";
    const link = data<{ url: string }>(
      await (await consoleClient(this)).request("GET", `/api/admin/kyc/${documentId}`),
    );
    const file = await fetch(link.url);
    assert.equal(file.status, 200);
    const text = Buffer.from(await file.arrayBuffer()).toString("latin1");
    assert.ok(text.startsWith("%PDF-"), "Not a PDF");
    assert.match(text, /PLACEHOLDER DOCUMENT/);
  },
);

Then(
  "{string} has the government ID accepted and four documents waiting for review",
  async function (this: KlikWorld, name: string) {
    const rider = await review(this, "pending", name);
    const states = Object.fromEntries(rider.checklist.map((item) => [item.type, item.state]));
    assert.equal(states.government_id, "approved");
    assert.equal(rider.checklist.filter((item) => item.state === "pending").length, 4);
  },
);

Then(
  "{string} is suspended with the reason shown to the console",
  async function (this: KlikWorld, name: string) {
    const rider = await review(this, "suspended", name);
    assert.equal(rider.statusReason, demo(name).statusReason);
  },
);

Then("the console lists {string} for coaching", async function (this: KlikWorld, name: string) {
  await review(this, "coaching", name);
});

Then(
  "demo rider {string} can sign in with the test number and is online in San Fernando",
  async function (this: KlikWorld, name: string) {
    const client = new ApiClient(BASE_URL);
    client.headers.set("x-forwarded-for", randomIp());
    await signInWithPhone(client, demo(name).phone);
    const me = data<{ rider: { id: string; isOnline: boolean; zoneId: string } }>(
      await client.request("GET", "/api/rider/me"),
    );
    assert.equal(me.rider.id, demo(name).id);
    assert.equal(me.rider.isOnline, true);
    const [zone] = await this.db.query<{ slug: string }>(
      `select slug from public.zones where id = $1`,
      [me.rider.zoneId],
    );
    assert.equal(zone?.slug, "san-fernando-pampanga");
  },
);

Given(
  "a reviewer has accepted every document of {string} and approved the rider",
  async function (this: KlikWorld, name: string) {
    const admin = await consoleClient(this);
    const rider = await review(this, "pending", name);
    for (const item of rider.checklist) {
      if (item.state === "approved") continue;
      const accepted = await admin.post(`/api/admin/kyc/${item.document?.id ?? ""}`, {
        decision: "approve",
      });
      assert.equal(accepted.status, 200, accepted.bodyText);
    }
    const approved = await admin.post(`/api/admin/riders/${rider.id}/status`, {
      status: "active",
    });
    assert.equal(approved.status, 200, approved.bodyText);
    await review(this, "active", name);
  },
);

Then(
  "{string} is waiting for KYC review again with five documents to check",
  async function (this: KlikWorld, name: string) {
    const rider = await review(this, "pending", name);
    assert.equal(rider.status, "pending_kyc");
    assert.equal(rider.checklist.filter((item) => item.state === "pending").length, 5);
  },
);

Then(
  "no demo rider has a second account or a second set of documents",
  async function (this: KlikWorld) {
    const [row] = await this.db.query<{
      riders: number;
      accounts: number;
      documents: number;
      distinct_documents: number;
    }>(
      `select (select count(*)::int from public.riders where id::text like 'de400000-%') as riders,
              (select count(*)::int from auth.users where phone = any($1::text[])) as accounts,
              (select count(*)::int from public.rider_kyc_documents where rider_id::text like 'de400000-%') as documents,
              (select count(distinct (rider_id, type))::int from public.rider_kyc_documents
                where rider_id::text like 'de400000-%') as distinct_documents`,
      [DEMO_RIDERS.map((r) => r.phone.slice(1))],
    );
    assert.equal(row?.riders, DEMO_RIDERS.length);
    assert.equal(row.accounts, DEMO_RIDERS.length);
    assert.equal(row.documents, row.distinct_documents);
  },
);

Then("no demo rider is online or approved", async function (this: KlikWorld) {
  const [row] = await this.db.query<{ online: number; active: number }>(
    `select count(*) filter (where is_online)::int as online,
            count(*) filter (where status = 'active')::int as active
       from public.riders where id::text like 'de400000-%'`,
  );
  assert.equal(row?.online, 0);
  assert.equal(row.active, 0);
});
