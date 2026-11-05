import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

describe("server environment", () => {
  it("starts with safe defaults when optional variables are missing", () => {
    const env = parseServerEnv({ NODE_ENV: "production" });
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.APP_VERSION).toBe("dev");
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
  });

  it("uses the Vercel commit SHA as the version when present", () => {
    const env = parseServerEnv({
      NODE_ENV: "production",
      VERCEL_GIT_COMMIT_SHA: "abcdef1234567890",
    });
    expect(env.APP_VERSION).toBe("abcdef1");
  });

  it("rejects an invalid log level or Supabase URL with the variable name, never its value", () => {
    expect(() => parseServerEnv({ NODE_ENV: "production", LOG_LEVEL: "loud" })).toThrow(
      /LOG_LEVEL/,
    );
    expect(() =>
      parseServerEnv({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "secret-not-a-url" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() =>
      parseServerEnv({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "secret-not-a-url" }),
    ).not.toThrow(/secret-not-a-url/);
  });
});
