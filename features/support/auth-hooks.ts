import { Before } from "@cucumber/cucumber";
import { randomIp } from "./supabase-test-auth";
import type { KlikWorld } from "./world";

/**
 * Each @auth scenario acts from its own network (X-Forwarded-For) and starts with fresh rate-limit
 * counters for the reserved Supabase test numbers (+639170000101…112, and the seeded riders'
 * +639170000021/22 that dispatch scenarios sign in as) only, so local reruns within
 * the hour are not blocked by the 5-codes-per-phone limit. Counters
 * per network (OTP and partner applications) are reset only for the documentation range
 * 198.51.100.0/24 that tests use, so random test networks that collide never inherit a used-up
 * budget. Real numbers and networks are never reset.
 */
Before({ tags: "@auth" }, async function (this: KlikWorld) {
  this.api.headers.set("x-forwarded-for", randomIp());
  await this.db.query(
    `delete from private.rate_limit_counters
     where key like 'otp:phone:+6391700001%' or key like 'otp-verify:phone:+6391700001%'
        or key in ('otp:phone:+639170000021', 'otp:phone:+639170000022',
                   'otp-verify:phone:+639170000021', 'otp-verify:phone:+639170000022')
        or key = 'otp:ip:unknown'
        or key like 'otp:ip:198.51.100.%'
        or key like 'partner-apply:ip:198.51.100.%' or key like 'menu-import:merchant:5eed0000-%'
        or key like 'delivery-pin:%'`,
  );
});
