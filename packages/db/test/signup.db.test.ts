import { expect, it } from "vitest";
import { describeDb, useRollbackTransaction } from "./support";

describeDb("sign-up creates a profile and the customer role", () => {
  const { db, fx } = useRollbackTransaction();

  it("creates a profile with the name and an E.164 phone, and grants the customer role", async () => {
    const id = await fx().user("Juana Dela Cruz");
    const profile = await db().query<{
      full_name: string;
      phone: string;
      locale: string;
      status: string;
    }>(`select full_name, phone, locale, status::text from public.profiles where id = $1`, [id]);
    expect(profile.rows[0]?.full_name).toBe("Juana Dela Cruz");
    expect(profile.rows[0]?.phone).toMatch(/^\+639\d{9}$/);
    expect(profile.rows[0]?.locale).toBe("en");
    expect(profile.rows[0]?.status).toBe("active");
    const roles = await db().query<{ role: string }>(
      `select role::text from public.user_roles where user_id = $1`,
      [id],
    );
    expect(roles.rows).toEqual([{ role: "customer" }]);
  });

  it("allows one person to hold several roles (a merchant owner who also orders)", async () => {
    const id = await fx().user("Owner Who Orders", [{ role: "rider" }]);
    const roles = await db().query<{ role: string }>(
      `select role::text from public.user_roles where user_id = $1 order by 1`,
      [id],
    );
    expect(roles.rows.map((r) => r.role)).toEqual(["customer", "rider"]);
  });

  it("requires merchant roles to name the merchant and coordinators to name the zone", async () => {
    const id = await fx().user("Scoped");
    for (const role of ["merchant_owner", "merchant_staff", "coordinator"]) {
      await db().query("savepoint s");
      await expect(
        db().query(`insert into public.user_roles (user_id, role) values ($1, $2)`, [id, role]),
      ).rejects.toThrow(/user_roles_scope/);
      await db().query("rollback to savepoint s");
    }
  });
});
