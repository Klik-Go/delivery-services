import { MemoryLogger } from "@klikgo/core/testing";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { SupabaseAuthGateway } from "./supabase-auth-gateway";
import { SupabasePhoneAccountAdmin } from "./supabase-phone-account-admin";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.CI && !(URL && ANON && SERVICE)) {
  throw new Error("Supabase URL and keys must be set in CI for auth adapter tests.");
}
const describeAuth = describe.skipIf(!(URL && ANON && SERVICE));

/** Unused test range (+63917000097x) so the seed and other suites are never touched. */
const PHONE = `+63917000097${String(Date.now() % 10)}`;

/** The placeholder sign-in path against the local Supabase Auth server. */
describeAuth("placeholder sign-in adapters (local Supabase Auth)", () => {
  // No generated Database type here: narrow to the plain client the adapters accept.
  const client = (key: string): SupabaseClient =>
    createClient(URL ?? "", key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as SupabaseClient;
  const admin = client(SERVICE ?? "");
  const accounts = new SupabasePhoneAccountAdmin(admin, new MemoryLogger());
  const created: string[] = [];

  afterAll(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
  });

  it("creates a confirmed customer account for a new phone, then finds the same one again", async () => {
    const first = await accounts.findOrCreateByPhone(PHONE);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    created.push(first.value.userId);

    const again = await accounts.findOrCreateByPhone(PHONE);
    expect(again).toEqual({ ok: true, value: { userId: first.value.userId } });

    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", first.value.userId);
    expect(roles).toEqual([{ role: "customer" }]);
  });

  it("signs in with the rotated password, and the previous password stops working", async () => {
    const account = await accounts.findOrCreateByPhone(PHONE);
    if (!account.ok) throw new Error("account");
    const first = await accounts.rotatePassword(account.value.userId);
    const second = await accounts.rotatePassword(account.value.userId);
    if (!first.ok || !second.ok) throw new Error("rotate");
    expect(second.value).not.toBe(first.value);
    expect(second.value.length).toBeGreaterThanOrEqual(40);

    const browser = () => new SupabaseAuthGateway(client(ANON ?? ""), new MemoryLogger());
    expect(await browser().signInWithPhonePassword(PHONE, second.value)).toEqual({
      ok: true,
      value: { userId: account.value.userId },
    });
    expect((await browser().signInWithPhonePassword(PHONE, first.value)).ok).toBe(false);
  });
});
