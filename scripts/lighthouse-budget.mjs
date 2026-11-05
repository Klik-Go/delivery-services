#!/usr/bin/env node
/**
 * Lighthouse budget for the customer PWA (docs/BUILD_PLAN.md Phase 4: "Lighthouse ≥ 85 on the
 * store page"). Runs Lighthouse's default mobile profile (emulated mid-range phone, simulated
 * slow 4G) against a running production build and fails when a category falls under its budget.
 *
 *   pnpm build && pnpm --filter @klikgo/web start &   # or any BASE_URL
 *   pnpm lighthouse
 *
 * Chromium comes from Playwright (already installed for e2e); CHROME_PATH overrides it.
 * Lighthouse 12 removed the PWA category, so installability is checked in
 * apps/web/e2e/customer.spec.ts through Chrome's own installability check instead.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const PORT = Number(process.env.LIGHTHOUSE_DEBUG_PORT ?? 9333);
const PAGES = ["/s/aling-nenas-karinderya", "/"];
/**
 * Minimum scores (0–1) per Lighthouse category. SEO is left out until launch: robots.ts blocks
 * indexing on purpose, which Lighthouse scores as an SEO failure.
 */
const BUDGET = { performance: 0.85, accessibility: 0.95, "best-practices": 0.9 };
/** Chrome sometimes drops the first trace in a fresh profile (NO_NAVSTART); try again. */
const ATTEMPTS = 3;
/** Simulated-throttling scores vary run to run; judge the median run (Lighthouse's advice). */
const RUNS = Number(process.env.LIGHTHOUSE_RUNS ?? 3);
const REPORT_DIR = "lighthouse-report";

const browser = await chromium.launch({
  args: [`--remote-debugging-port=${PORT}`],
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});

/** One Lighthouse run, retried when Lighthouse itself fails (not when the page scores low). */
async function audit(url) {
  for (let attempt = 1; ; attempt++) {
    const result = await lighthouse(url, {
      port: PORT,
      output: "html",
      logLevel: "error",
      onlyCategories: Object.keys(BUDGET),
    });
    if (!result) throw new Error(`Lighthouse returned no result for ${url}`);
    if (!result.lhr.runtimeError || attempt >= ATTEMPTS) return result;
    process.stdout.write(`     retrying ${url}: ${result.lhr.runtimeError.code}\n`);
  }
}

let failed = false;
try {
  await mkdir(REPORT_DIR, { recursive: true });
  for (const path of PAGES) {
    const url = new URL(path, BASE_URL).toString();
    const runs = [];
    for (let run = 0; run < RUNS; run++) runs.push(await audit(url));
    const performance = (r) => r.lhr.categories.performance?.score ?? 0;
    runs.sort((a, b) => performance(a) - performance(b));
    const result = runs[Math.floor(runs.length / 2)];
    process.stdout.write(
      `     ${path} performance runs: ${runs.map((r) => Math.round(performance(r) * 100)).join(", ")}\n`,
    );
    const name = path === "/" ? "home" : path.replaceAll("/", "-").replace(/^-/, "");
    await writeFile(`${REPORT_DIR}/${name}.html`, String(result.report));

    for (const [category, minimum] of Object.entries(BUDGET)) {
      const score = result.lhr.categories[category]?.score ?? 0;
      const ok = score >= minimum;
      failed ||= !ok;
      process.stdout.write(
        `${ok ? "ok  " : "FAIL"} ${path} ${category} ${Math.round(score * 100)} (budget ${minimum * 100})\n`,
      );
    }
    const lcp = result.lhr.audits["largest-contentful-paint"]?.displayValue ?? "?";
    const tbt = result.lhr.audits["total-blocking-time"]?.displayValue ?? "?";
    process.stdout.write(`     ${path} LCP ${lcp}, TBT ${tbt}\n`);
  }
} finally {
  await browser.close();
}

if (failed) {
  process.stderr.write(`Lighthouse budget missed; see ${REPORT_DIR}/*.html\n`);
  process.exit(1);
}
