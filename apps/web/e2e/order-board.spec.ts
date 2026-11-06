import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  authStackConfigured,
  E2E_PHONES,
  merchantIdByName,
  resetTestNumberLimits,
  signedInMerchant,
  signInWithPhone,
  sql,
} from "./support/auth";

// Needs the seeded database and Supabase Realtime (CI starts both).
test.skip(!authStackConfigured(), "The seeded database is not configured for this run");

const AYALA = { lat: 14.5547, lng: 121.0244 };

async function seriousViolations(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

/** Places a cash order for 2 Kapeng Barako (Less sugar) through the BFF, like checkout does. */
async function placeCodOrder(
  api: APIRequestContext,
  merchantId: string,
): Promise<{ id: string; code: string }> {
  const rows = await sql(
    `select i.id as item, o.id as option from public.menu_items i
       join public.modifier_groups g on g.menu_item_id = i.id
       join public.modifier_options o on o.modifier_group_id = g.id
      where i.merchant_id = $1 and i.name = 'Kapeng Barako' and o.name = 'Less sugar'`,
    [merchantId],
  );
  const row = rows.rows[0] as { item: string; option: string } | undefined;
  if (!row) throw new Error("Seed data missing (run pnpm db:reset)");
  const response = await api.post("/api/orders", {
    headers: { "Idempotency-Key": `e2e-board-${crypto.randomUUID()}` },
    data: {
      merchantId,
      items: [{ itemId: row.item, quantity: 2, optionIds: [row.option] }],
      dropoff: AYALA,
      tipCentavos: 0,
      paymentMethod: "cod",
      address: { label: "Office", landmark: "Blue tower lobby", contactPhone: "09170000111" },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const placed = (await response.json()) as { data: { orderId: string; code: string } };
  return { id: placed.data.orderId, code: placed.data.code };
}

test.beforeAll(async () => {
  // Checkout runs at any hour: keep the seeded store open all day for this run.
  const allDay = [{ open: "00:00", close: "23:59" }];
  const hours = Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, allDay]),
  );
  await sql(
    "update public.merchants set hours = $1, is_open = true, accepts_cod = true where slug = 'kapet-tinapay'",
    [JSON.stringify(hours)],
  );
});

test.beforeEach(async () => {
  await resetTestNumberLimits();
});

test.describe("Feature: merchant order board and live tracking", () => {
  test("Scenario: the store sees a new order within 2 seconds and the customer's tracker follows live", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    const merchantId = await merchantIdByName("Kape't Tinapay");
    const store = await browser.newContext({ ...testInfo.project.use, baseURL: baseURL ?? "" });
    await store.addCookies(
      (await (await signedInMerchant(baseURL ?? "", merchantId)).storageState()).cookies,
    );
    const board = await store.newPage();
    await board.goto(`/merchant/orders?store=${merchantId}`);
    await expect(board.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();
    // The board listens on its private Realtime channel before the order is placed.
    await expect(board.getByTestId("live-state")).toHaveText("Live", { timeout: 15_000 });

    const phones = E2E_PHONES[testInfo.project.name as keyof typeof E2E_PHONES];
    await signInWithPhone(page.request, phones.tracker);
    const placedAt = Date.now();
    const order = await placeCodOrder(page.request, merchantId);
    const card = board.locator(`[data-code="${order.code}"]`);
    await expect(card).toBeVisible({ timeout: 2000 });
    testInfo.annotations.push({
      type: "new order seen after",
      description: `${String(Date.now() - placedAt)} ms`,
    });
    await expect(card.getByTestId("confirm-countdown")).toContainText("Accept within");
    expect(await seriousViolations(board)).toEqual([]);

    await page.goto(`/orders/${order.id}`);
    await expect(page.getByTestId("order-status")).toHaveText("Sent to the store");
    await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 15_000 });

    await card.getByRole("button", { name: "Accept, ready in 15 minutes" }).click();
    // No reload: the customer's page hears the change on the order's channel.
    await expect(page.getByTestId("order-status")).toHaveText("Being prepared", { timeout: 3000 });
    await expect(page.getByTestId("ready-by")).toContainText("about 15 minutes");
    await expect(
      page.getByTestId("order-stepper").getByText("Accepted by the store"),
    ).toBeVisible();

    const preparing = board.locator(`[data-code="${order.code}"]`);
    await preparing.getByRole("button", { name: "Mark ready" }).click();
    await expect(page.getByTestId("order-status")).toHaveText("Ready for pickup", {
      timeout: 3000,
    });
    expect(await seriousViolations(page)).toEqual([]);
    await store.close();
  });

  test("Scenario: the store rejects with a reason and the customer sees why", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    const merchantId = await merchantIdByName("Kape't Tinapay");
    const store = await browser.newContext({ ...testInfo.project.use, baseURL: baseURL ?? "" });
    await store.addCookies(
      (await (await signedInMerchant(baseURL ?? "", merchantId)).storageState()).cookies,
    );
    const board = await store.newPage();
    await board.goto(`/merchant/orders?store=${merchantId}`);
    await expect(board.getByTestId("live-state")).toHaveText("Live", { timeout: 15_000 });

    const phones = E2E_PHONES[testInfo.project.name as keyof typeof E2E_PHONES];
    await signInWithPhone(page.request, phones.tracker);
    const order = await placeCodOrder(page.request, merchantId);
    await page.goto(`/orders/${order.id}`);
    await expect(page.getByTestId("order-status")).toHaveText("Sent to the store");

    const card = board.locator(`[data-code="${order.code}"]`);
    await card.getByRole("button", { name: "Can't take it" }).click();
    await card.getByRole("button", { name: "Too busy right now" }).click();
    await expect(card).toBeHidden();
    await expect(page.getByTestId("order-status")).toHaveText(
      "The store couldn't take this order",
      {
        timeout: 3000,
      },
    );
    await expect(page.getByTestId("end-reason")).toHaveText("Too busy right now");
    await store.close();
  });

  test("Scenario: the customer cancels before the store accepts", async ({ page }, testInfo) => {
    const merchantId = await merchantIdByName("Kape't Tinapay");
    const phones = E2E_PHONES[testInfo.project.name as keyof typeof E2E_PHONES];
    await signInWithPhone(page.request, phones.tracker);
    const order = await placeCodOrder(page.request, merchantId);
    await page.goto(`/orders/${order.id}`);
    await page.getByRole("button", { name: "Cancel order" }).click();
    await expect(page.getByTestId("order-status")).toHaveText("Cancelled");
    await expect(page.getByRole("button", { name: "Cancel order" })).toBeHidden();
  });
});
