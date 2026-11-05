import type { IRateLimiter, RateLimitDecision, RateLimitRule } from "@klikgo/core";
import type { PrismaClient } from "@klikgo/db";

/** Fixed-window rate limiter backed by `private.hit_rate_limit` (one atomic upsert per hit). */
export class PostgresRateLimiter implements IRateLimiter {
  constructor(private readonly prisma: PrismaClient) {}

  /** Counts one hit for `key` and returns whether it is within `rule`. */
  async hit(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    const rows = await this.prisma.$queryRaw<
      { allowed: boolean; remaining: number; retry_after_seconds: number }[]
    >`
      select * from private.hit_rate_limit(${key}, ${rule.limit}::integer, ${rule.windowSeconds}::integer)`;
    const row = rows[0];
    if (!row) throw new Error("hit_rate_limit returned no row");
    return {
      allowed: row.allowed,
      remaining: Number(row.remaining),
      retryAfterSeconds: Number(row.retry_after_seconds),
    };
  }
}
