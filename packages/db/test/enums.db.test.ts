import { ORDER_STATUS_TRANSITIONS, POSTGRES_ENUMS } from "@klikgo/types";
import { expect, it } from "vitest";
import { describeDb, useRollbackTransaction } from "./support";

describeDb("database enums match the shared TypeScript enums", () => {
  const { db } = useRollbackTransaction();

  it.each(Object.entries(POSTGRES_ENUMS))(
    "keeps %s identical in Postgres and packages/types",
    async (type, values) => {
      const { rows } = await db().query<{ value: string }>(
        `select unnest(enum_range(null::public.${type}))::text as value`,
      );
      expect(rows.map((r) => r.value)).toEqual([...values]);
    },
  );

  it("keeps the order status transition table identical to ORDER_STATUS_TRANSITIONS", async () => {
    const { rows } = await db().query<{ from_status: string; to_status: string }>(
      `select from_status::text, to_status::text from public.order_status_transitions order by 1, 2`,
    );
    const expected = Object.entries(ORDER_STATUS_TRANSITIONS)
      .flatMap(([from, tos]) => tos.map((to) => ({ from_status: from, to_status: to })))
      .sort(
        (a, b) =>
          a.from_status.localeCompare(b.from_status) || a.to_status.localeCompare(b.to_status),
      );
    expect(rows).toEqual(expected);
  });
});
