"use client";

import type { SystemStatus } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import type { JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import type { Wire } from "@/components/admin/wire";
import { fetchData } from "@/lib/post-json";

/** Job lag, database schedules, failing webhooks and missed deadlines, refreshed every 30 s. */
export function SystemStatusView(): JSX.Element {
  const t = useTranslations("Hardening.system");
  const locale = useLocale();
  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: () => fetchData<Wire<SystemStatus>>("/api/admin/system", t("failed")),
    refetchInterval: 30_000,
  });
  if (status.isPending) return <p className="text-ink-muted">{t("loading")}</p>;
  if (status.isError) return <FormError message={status.error.message} />;
  const s = status.data;
  const time = new Intl.DateTimeFormat(locale === "fil" ? "fil-PH" : "en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  const at = (value: string | null): string => (value ? time.format(new Date(value)) : "—");
  const jobs = s.jobs;
  const jobsLine =
    jobs.lagSeconds === null
      ? t("jobsNever")
      : t(jobs.healthy ? "jobsHealthy" : "jobsLate", { seconds: jobs.lagSeconds });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink-muted text-sm">{t("checkedAt", { time: at(s.checkedAt) })}</p>
        <Button variant="secondary" onClick={() => void status.refetch()}>
          {t("refresh")}
        </Button>
      </div>

      <section aria-labelledby="sys-jobs" className="flex flex-col gap-2" data-testid="system-jobs">
        <h2 id="sys-jobs" className="text-ink text-lg font-bold">
          {t("jobs")}
        </h2>
        <p
          className={`rounded-lg p-3 font-semibold ${jobs.healthy ? "bg-sheet-alt text-ink" : "bg-danger-50 text-danger-900"}`}
        >
          {jobsLine}
        </p>
        {jobs.lastRun ? (
          <p className="text-ink text-sm">
            {t("lastRun", {
              time: at(jobs.lastRun.startedAt),
              outcome:
                jobs.lastRun.ok === false
                  ? t("failedRun", { error: jobs.lastRun.error ?? "?" })
                  : t("ok"),
            })}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="sys-cron" className="flex flex-col gap-2">
        <h2 id="sys-cron" className="text-ink text-lg font-bold">
          {t("cron")}
        </h2>
        <ul className="flex flex-col gap-1">
          {s.cron.map((job) => (
            <li key={job.name} className="text-ink text-sm">
              <span className="font-semibold">{job.name}</span> · {job.schedule} ·{" "}
              {job.lastRunAt ? `${at(job.lastRunAt)} ${job.lastStatus ?? ""}` : t("cronNever")}
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="sys-webhooks"
        className="flex flex-col gap-2"
        data-testid="system-webhooks"
      >
        <h2 id="sys-webhooks" className="text-ink text-lg font-bold">
          {t("webhooks")}
        </h2>
        {s.webhookFailures.length === 0 ? (
          <p className="text-ink-muted">{t("webhooksNone")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {s.webhookFailures.map((hook, index) => (
              <li key={`${hook.receivedAt}-${String(index)}`} className="text-ink text-sm">
                {at(hook.receivedAt)} · {hook.gateway} {hook.type} ·{" "}
                {hook.error ?? t("webhookStuck")}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sys-sla" className="flex flex-col gap-2" data-testid="system-sla">
        <h2 id="sys-sla" className="text-ink text-lg font-bold">
          {t("sla")}
        </h2>
        {s.slaBreaches.length === 0 ? (
          <p className="text-ink-muted">{t("slaNone")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {s.slaBreaches.map((breach) => (
              <li key={`${breach.orderId}-${breach.kind}`} className="text-ink text-sm">
                {at(breach.at)} · {breach.code} · {breach.merchantName} ·{" "}
                {t(breach.kind === "store_late" ? "storeLate" : "noRider")}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
