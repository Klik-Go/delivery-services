import { beforeEach, expect, it } from "vitest";
import { asUser } from "../src/testing";
import { describeDb, failureOf, useRollbackTransaction } from "./support";
import { buildWorld, type World } from "./world";

describeDb("storage buckets and file access", () => {
  const { db, fx } = useRollbackTransaction();
  let w: World;

  beforeEach(async () => {
    w = await buildWorld(db(), fx());
  });

  const upload = (bucket: string, name: string) =>
    db().query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name]);

  it("has a public menu-photos bucket and a private rider-kyc bucket", async () => {
    const { rows } = await db().query<{ id: string; public: boolean }>(
      `select id, public from storage.buckets where id in ('menu-photos', 'rider-kyc') order by id`,
    );
    expect(rows).toEqual([
      { id: "menu-photos", public: true },
      { id: "rider-kyc", public: false },
    ]);
  });

  it("lets merchant staff upload menu photos into their own store's folder only", async () => {
    expect(
      await asUser(db(), w.users.staffA, () =>
        failureOf(db(), () => upload("menu-photos", `${w.merchantA}/adobo.webp`)),
      ),
    ).toBeNull();
    expect(
      await asUser(db(), w.users.staffA, () =>
        failureOf(db(), () => upload("menu-photos", `${w.merchantB}/adobo.webp`)),
      ),
    ).toMatch(/row-level security/);
    expect(
      await asUser(db(), w.users.customer1, () =>
        failureOf(db(), () => upload("menu-photos", `${w.merchantA}/x.webp`)),
      ),
    ).toMatch(/row-level security/);
  });

  it("lets a rider upload KYC files into their own folder, never read them back; admins can read", async () => {
    expect(
      await asUser(db(), w.users.riderA1, () =>
        failureOf(db(), () => upload("rider-kyc", `${w.riders.A1}/id-front.jpg`)),
      ),
    ).toBeNull();
    expect(
      await asUser(db(), w.users.riderA1, () =>
        failureOf(db(), () => upload("rider-kyc", `${w.riders.A2}/id-front.jpg`)),
      ),
    ).toMatch(/row-level security/);
    const q = `select name from storage.objects where bucket_id = 'rider-kyc' and name like $1`;
    const own = await asUser(db(), w.users.riderA1, () => db().query(q, [`${w.riders.A1}/%`]));
    expect(own.rowCount).toBe(0);
    const coordinator = await asUser(db(), w.users.coordA, () =>
      db().query(q, [`${w.riders.A1}/%`]),
    );
    expect(coordinator.rowCount).toBe(0);
    const admin = await asUser(db(), w.users.admin, () => db().query(q, [`${w.riders.A1}/%`]));
    expect(admin.rowCount).toBe(1);
  });
});
