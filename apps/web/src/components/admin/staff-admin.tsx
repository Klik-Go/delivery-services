"use client";

import type { StaffGrant } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { fetchData, requestJson } from "@/lib/post-json";
import type { Wire } from "./wire";

/** Staff roles with their scope; admins can remove access (audited). */
export function StaffAdmin(): JSX.Element {
  const t = useTranslations("Ops.staff");
  const tOps = useTranslations("Ops");
  const tRoles = useTranslations("Admin.roles");
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const staff = useQuery({
    queryKey: ["ops-staff"],
    queryFn: () => fetchData<Wire<StaffGrant>[]>("/api/admin/staff", tOps("failed")),
  });
  if (staff.isPending) return <p className="text-ink-muted">{tOps("loading")}</p>;
  if (staff.isError) return <FormError message={staff.error.message} />;

  const revoke = async (grant: Wire<StaffGrant>): Promise<void> => {
    if (
      !window.confirm(
        t("confirmRevoke", { role: tRoles(grant.role), name: grant.name ?? grant.email ?? "" }),
      )
    )
      return;
    setBusy(true);
    setError(null);
    const result = await requestJson<unknown>(
      "DELETE",
      `/api/admin/staff/${grant.id}`,
      undefined,
      tOps("failed"),
    );
    setBusy(false);
    if (!result.ok) setError(result.message);
    void queryClient.invalidateQueries({ queryKey: ["ops-staff"] });
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? <FormError message={error} /> : null}
      <ul className="flex flex-col gap-2" data-testid="ops-staff">
        {staff.data.map((grant) => (
          <li
            key={grant.id}
            className="bg-surface-muted flex flex-wrap items-center gap-2 rounded-lg p-3"
            data-grant={grant.email ?? grant.id}
          >
            <div className="flex-1">
              <p className="text-ink font-semibold">{grant.name ?? grant.email ?? grant.userId}</p>
              <p className="text-ink-muted text-sm">
                {tRoles(grant.role)} ·{" "}
                {grant.zoneName
                  ? t("scope.zone", { name: grant.zoneName })
                  : grant.merchantName
                    ? t("scope.store", { name: grant.merchantName })
                    : t("scope.all")}
              </p>
            </div>
            <Button variant="secondary" disabled={busy} onClick={() => void revoke(grant)}>
              {t("revoke")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
