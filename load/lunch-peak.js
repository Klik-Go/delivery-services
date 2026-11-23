/* global __ENV, __VU, __ITER, open */
/**
 * Lunch peak at 5x the expected pilot peak (docs/BUILD_PLAN.md Phase 11, docs/runbooks/LOAD_TEST.md):
 * customers browse (feed, store, quote), some place cash-on-delivery orders, the store accepts
 * them, and the scheduler dispatches riders. Passes only with p95 API latency under 500 ms and no
 * failed requests.
 *
 * Pilot peak (assumption, docs/ARCHITECTURE.md §4l): 60 orders and 600 browsing sessions an hour
 * at lunch in one zone. 5x = 300 orders/hour (5 a minute) and 3,000 sessions/hour (50 a minute).
 *
 * Run: node --import tsx load/prepare-sessions.ts 20 && k6 run load/lunch-peak.js
 */
import http from "k6/http";
import { check, fail } from "k6";
import { SharedArray } from "k6/data";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const CRON_SECRET = __ENV.CRON_SECRET || "";
const MINUTES = Number(__ENV.MINUTES || 5);
const MULTIPLIER = Number(__ENV.MULTIPLIER || 5);
const AYALA = { lat: 14.5547, lng: 121.0244 };

const sessions = new SharedArray("sessions", () => [JSON.parse(open("./.sessions.json"))]);

export const options = {
  scenarios: {
    browse: {
      executor: "constant-arrival-rate",
      exec: "browse",
      rate: 10 * MULTIPLIER,
      timeUnit: "1m",
      duration: `${MINUTES}m`,
      preAllocatedVUs: 10,
    },
    order: {
      executor: "constant-arrival-rate",
      exec: "order",
      rate: 1 * MULTIPLIER,
      timeUnit: "1m",
      duration: `${MINUTES}m`,
      preAllocatedVUs: 5,
    },
    store: {
      executor: "constant-arrival-rate",
      exec: "store",
      rate: 4,
      timeUnit: "1m",
      duration: `${MINUTES}m`,
      preAllocatedVUs: 2,
    },
    dispatch: {
      executor: "constant-arrival-rate",
      exec: "dispatch",
      rate: 6,
      timeUnit: "1m",
      duration: `${MINUTES}m`,
      preAllocatedVUs: 2,
    },
  },
  thresholds: {
    "http_req_duration{api:yes}": ["p(95)<500"],
    http_req_failed: ["rate==0"],
    checks: ["rate==1"],
  },
};

/** Each virtual user is its own network, as real phones are. */
function headers(cookie) {
  const ip = `10.${__VU % 250}.${Math.floor(__ITER / 250) % 250}.${(__ITER % 250) + 1}`;
  return {
    "content-type": "application/json",
    "x-forwarded-for": ip,
    ...(cookie ? { cookie } : {}),
  };
}

/** Accepting can lose a race with the store-deadline job (409): expected, not a failure. */
const ACCEPT_STATUSES = http.expectedStatuses(200, 409);

function api(method, path, body, cookie, extra = {}, expected = undefined) {
  const params = {
    headers: { ...headers(cookie), ...extra },
    tags: { api: "yes", name: path.replace(/[0-9a-f-]{36}/g, ":id").split("?")[0] },
    ...(expected ? { responseCallback: expected } : {}),
  };
  return method === "GET"
    ? http.get(`${BASE}${path}`, params)
    : http.request(
        method,
        `${BASE}${path}`,
        body === undefined ? null : JSON.stringify(body),
        params,
      );
}

function cart(s) {
  const item = s.items[(__VU + __ITER) % s.items.length];
  return { merchantId: s.merchantId, items: [{ itemId: item, quantity: 2, optionIds: [] }] };
}

/** Home feed, a store page's data and a cart quote, as a guest would. */
export function browse() {
  const s = sessions[0];
  const dropoff = { lat: AYALA.lat + ((__ITER % 10) - 5) * 0.001, lng: AYALA.lng };
  check(api("GET", `/api/feed?lat=${dropoff.lat}&lng=${dropoff.lng}`), {
    feed: (r) => r.status === 200,
  });
  check(api("GET", `/api/stores/${s.storeSlug}`), { store: (r) => r.status === 200 });
  check(api("POST", "/api/cart/quote", { ...cart(s), dropoff }), {
    quote: (r) => r.status === 200,
  });
}

/** A signed-in customer checks out and places a cash-on-delivery order. */
export function order() {
  const s = sessions[0];
  const cookie = s.customers[(__VU * 7 + __ITER) % s.customers.length];
  const body = {
    ...cart(s),
    dropoff: AYALA,
    paymentMethod: "cod",
    tipCentavos: 0,
    address: { label: "Office", landmark: "Blue tower lobby", contactPhone: "09170000103" },
  };
  check(api("POST", "/api/checkout/quote", body, cookie), { checkout: (r) => r.status === 200 });
  const placed = api("POST", "/api/orders", body, cookie, {
    "idempotency-key": `k6-${__VU}-${__ITER}-${Date.now()}`,
  });
  if (!check(placed, { placed: (r) => r.status === 201 }))
    fail(`order: ${placed.status} ${placed.body}`);
}

/** The store owner looks at the board and accepts what is waiting. */
export function store() {
  const s = sessions[0];
  const board = api("GET", `/api/merchant/${s.merchantId}/orders`, undefined, s.owner);
  check(board, { board: (r) => r.status === 200 });
  const waiting = (board.json("data.new") || []).slice(0, 5);
  for (const o of waiting) {
    const accepted = api(
      "POST",
      `/api/orders/${o.id}/accept`,
      { prepMinutes: 15 },
      s.owner,
      {},
      ACCEPT_STATUSES,
    );
    // A race with the store-deadline job can make an order unacceptable; anything else fails.
    check(accepted, { accepted: (r) => r.status === 200 || r.status === 409 });
  }
}

/** The scheduler: dispatch offers, queued messages, refunds. */
export function dispatch() {
  if (!CRON_SECRET) return;
  const res = http.post(`${BASE}/api/internal/jobs`, null, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
    tags: { api: "yes", name: "/api/internal/jobs" },
  });
  check(res, { jobs: (r) => r.status === 200 });
}
