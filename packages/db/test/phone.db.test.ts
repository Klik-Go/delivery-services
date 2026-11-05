import { expect, it } from "vitest";
import { describeDb, failureOf, useRollbackTransaction } from "./support";

/** The database accepts every Philippine mobile prefix the app accepts (packages/core phone.ts). */
describeDb("phone numbers: Philippine mobiles", () => {
  const { db } = useRollbackTransaction();

  const waitlist = (phone: string) =>
    db().query(
      `insert into public.waitlist_signups (name, phone, barangay, location)
       values ('Test', $1, 'Poblacion', 'SRID=4326;POINT(120.16 15.04)')`,
      [phone],
    );
  const application = (phone: string) =>
    db().query(
      `insert into public.merchant_applications
         (business_name, owner_name, phone, email, barangay, city, location, category)
       values ('Test Store', 'Owner', $1, 'owner@example.test', 'Poblacion', 'San Marcelino',
               'SRID=4326;POINT(120.16 15.04)', 'food')`,
      [phone],
    );

  it.each(["+639171234567", "+639912345678", "+638951234567", "+638171234567"])(
    "accepts the mobile %s on the waitlist and on partner applications",
    async (phone) => {
      await waitlist(phone);
      await application(phone);
    },
  );

  it.each(["+63281234567", "+14155550100", "+6391712345678", "09171234567"])(
    "refuses %s (landline, foreign, too long or not normalised)",
    async (phone) => {
      expect(await failureOf(db(), () => waitlist(phone))).toMatch(/waitlist_signups_phone_check/);
      expect(await failureOf(db(), () => application(phone))).toMatch(
        /merchant_applications_phone_check/,
      );
    },
  );
});
