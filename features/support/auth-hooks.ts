import { Before } from "@cucumber/cucumber";
import { randomIp } from "./supabase-test-auth";
import type { KlikWorld } from "./world";

/**
 * Each @auth scenario acts from its own network (X-Forwarded-For) and starts with fresh rate-limit
 * counters for the reserved Supabase test numbers (+639170000101…110) only, so local reruns within
 * the hour are not blocked by the 5-codes-per-phone limit. Partner-application counters are reset
 * only for the documentation network 198.51.100.0/24 that tests use. Real numbers are never reset.
 */
Before({ tags: "@auth" }, async function (this: KlikWorld) {
  this.api.headers.set("x-forwarded-for", randomIp());
  await this.db.query(
    `delete from private.rate_limit_counters
     where key like 'otp:phone:+6391700001%' or key like 'otp-verify:phone:+6391700001%' or key = 'otp:ip:unknown'
        or key like 'partner-apply:ip:198.51.100.%' or key like 'menu-import:merchant:5eed0000-%'`,
  );
});
