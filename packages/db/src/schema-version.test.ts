import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LATEST_MIGRATION } from "./schema-version";

describe("LATEST_MIGRATION", () => {
  it("names the newest migration in supabase/migrations", () => {
    const dir = fileURLToPath(new URL("../../../supabase/migrations", import.meta.url));
    const versions = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.split("_")[0])
      .sort();
    expect(LATEST_MIGRATION).toBe(versions.at(-1));
  });
});
