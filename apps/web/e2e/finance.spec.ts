import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { weekOf } from "@klikgo/core";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import {
  authStackConfigured,
  resetTestNumberLimits,
  signedInStaff,
  signInWithPhone,
  sql,
} from "./support/auth";

// Needs the seeded database (CI starts it).
test.skip(!authStackConfigured(), "The seeded database is not configured for this run");

const SHOTS = process.env.E2E_SCREENSHOT_DIR;
type Project = "mobile-pixel-7" | "desktop-chrome";
/** Each project uses its own store and rider, so parallel runs never share money. */
const PARTIES: Record<
  Project,
  { store: string; rider: string; riderPhone: string; weeksBack: number }
> = {
  "mobile-pixel-7": {
    store: "Aling Nena's Karinderya",
    rider: "5eed0000-0000-4000-8000-000000000201",
    riderPhone: "+639170000021",
    weeksBack: 2,
  },
  "desktop-chrome": {
    store: "Silog Express",
    rider: "5eed0000-0000-4000-8000-000000000202",
    riderPhone: "+639170000022",
    weeksBack: 4,
  },
};

async function seriousViolations(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function staffPage(
  browser: Browser,
  baseURL: string,
  project: Project,
  role: "admin" | "merchant_owner" | "coordinator",
  scope = {},
): Promise<Page> {
  const staff = await signedInStaff(baseURL, role, scope);
  const context = await browser.newContext({
    ...(project === "desktop-chrome" ? {} : devices["Pixel 7"]),
    baseURL,
  });
  await context.addCookies((await staff.storageState()).cookies);
  return context.newPage();
}

/** Books one balanced ledger transaction at a time (a past week, or now). */
async function book(
  lines: [string, string, string | null, number, number][],
  at: Date,
): Promise<void> {
  const txn = randomUUID();
  const values = lines
    .map(
      (_, i) =>
        `($1, $${String(i * 5 + 2)}::public.ledger_account, $${String(i * 5 + 3)}::public.ledger_party, $${String(i * 5 + 4)}::uuid, $${String(i * 5 + 5)}::int, $${String(i * 5 + 6)}::int, 'e2e', $${String(lines.length * 5 + 2)})`,
    )
    .join(", ");
  await sql(
    `insert into public.ledger_entries (txn_id, account, party_type, party_id, debit_centavos, credit_centavos, memo, created_at) values ${values}`,
    [txn, ...lines.flat(), at],
  );
}

test.beforeEach(async () => {
  await resetTestNumberLimits();
});

test.describe("Feature: finance", () => {
  test("Scenario: an admin settles a week and pays a store; the owner sees the statement", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const project = testInfo.project.name as Project;
    const party = PARTIES[project];
    const store = (await sql("select id from public.merchants where name = $1", [party.store]))
      .rows[0] as { id: string };
    // A week before every ledger row, so it holds only this test's money.
    const first = (await sql("select min(created_at) as at from public.ledger_entries"))
      .rows[0] as { at: Date | null };
    const week = weekOf(
      new Date((first.at ?? new Date()).getTime() - party.weeksBack * 7 * 86_400_000),
    );
    const at = new Date(week.startsAt.getTime() + 2 * 86_400_000);
    for (const amount of [18_000, 12_000]) {
      await book(
        [
          ["customer_deposits", "customer", randomUUID(), amount + 5_000, 0],
          ["merchant_payable", "merchant", store.id, 0, amount],
          ["platform_revenue", "platform", null, 0, 5_000],
        ],
        at,
      );
    }
    await sql(
      `insert into public.payout_accounts (party_type, party_id, method, account_name, account_number)
       values ('merchant', $1, 'gcash', 'Placeholder Owner', '09170000099')
       on conflict (party_type, party_id) do nothing`,
      [store.id],
    );

    const admin = await staffPage(browser, baseURL ?? "", project, "admin");
    await admin.goto(`/admin/finance?week=${week.start}`);
    await admin.getByRole("button", { name: "Settle this week" }).click();
    const row = admin.locator(`[data-payout="${party.store}"]`);
    await expect(row).toContainText("₱300.00");
    await shot(admin, `${project}-finance-payouts`);
    expect(await seriousViolations(admin)).toEqual([]);

    const download = admin.waitForEvent("download");
    await admin.getByRole("link", { name: "Download the transfer list (CSV)" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`klikgo-payouts-${week.start}.csv`);
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks);
    expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.toString("utf8")).toContain(`"${party.store}","GCash"`);

    await row.getByLabel("Transfer reference").fill(`GC-E2E-${project}`);
    await row.getByRole("button", { name: "Mark paid" }).click();
    await expect(row).toContainText(`Paid · GC-E2E-${project}`);
    await admin.context().close();

    const owner = await staffPage(browser, baseURL ?? "", project, "merchant_owner", {
      merchantId: store.id,
    });
    await owner.goto(`/merchant/payouts?store=${store.id}`);
    const statement = owner
      .locator("[data-testid=statements] li")
      .filter({ hasText: `GC-E2E-${project}` })
      .first();
    await expect(statement).toContainText("₱300.00");
    await statement.getByRole("button", { name: "See the orders" }).click();
    await expect(statement).toContainText("₱180.00");
    await shot(owner, `${project}-merchant-payouts`);
    expect(await seriousViolations(owner)).toEqual([]);
    await owner.context().close();
  });

  test("Scenario: a rider sets where they are paid; the coordinator records cash handed in", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    const project = testInfo.project.name as Project;
    const party = PARTIES[project];
    await signInWithPhone(page.request, party.riderPhone);
    await page.goto("/rider/payouts");
    const form = page.getByTestId("payout-account-form").or(page.getByTestId("payout-account"));
    await expect(form).toBeVisible();
    if (await page.getByTestId("payout-account").isVisible()) {
      await page.getByRole("button", { name: "Change" }).click();
    }
    await page.getByLabel("GCash").check();
    await page.getByLabel("Account name (as on the ID)").fill("Placeholder Rider");
    await page.getByLabel("Mobile number").fill("09170000098");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("payout-account")).toContainText(
      "GCash · Placeholder Rider · 09170000098",
    );
    await shot(page, `${project}-rider-payouts`);
    expect(await seriousViolations(page)).toEqual([]);

    // Cash the rider holds now, handed in at the hub.
    await book(
      [
        ["rider_cash_on_hand", "rider", party.rider, 5_000, 0],
        ["platform_revenue", "platform", null, 0, 5_000],
      ],
      new Date(),
    );
    const zone = (await sql("select id from public.zones where slug = 'makati'")).rows[0] as {
      id: string;
    };
    const coordinator = await staffPage(browser, baseURL ?? "", project, "coordinator", {
      zoneId: zone.id,
    });
    await coordinator.goto("/admin/finance");
    const name = project === "desktop-chrome" ? "Rosa Rider" : "Rico Rider";
    const holder = coordinator.locator(`[data-holder="${name}"]`);
    await expect(holder).toContainText("Holds");
    await holder.getByLabel("Amount received (₱)").fill("10");
    await holder.getByLabel("Receipt or reference").fill(`Hub ${project}`);
    await holder.getByRole("button", { name: "Record hand-in" }).click();
    await expect(holder.getByLabel("Amount received (₱)")).toHaveValue("");
    await shot(coordinator, `${project}-cash-hand-in`);
    const last = (
      await sql(
        "select reference from public.cod_remittances where rider_id = $1 order by created_at desc limit 1",
        [party.rider],
      )
    ).rows[0] as { reference: string };
    expect(last.reference).toBe(`Hub ${project}`);
    await coordinator.context().close();
  });
});
