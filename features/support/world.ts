import {
  After,
  AfterAll,
  Before,
  BeforeAll,
  setDefaultTimeout,
  setWorldConstructor,
  World,
  type IWorldOptions,
} from "@cucumber/cucumber";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ApiClient, type ApiResponse } from "./api-client";
import { DbHelper } from "./db-helper";
import { ScenarioData } from "./scenario-data";

/** State for @auth steps. */
export interface AuthScenario {
  phone?: string;
  userId?: string;
  invitePath?: string;
  accessToken?: string;
  refreshToken?: string;
  oldSession?: ApiClient;
  adminEmail?: string;
  scriptOutput?: string;
}

/** State for merchant onboarding, settings and menu steps. */
export interface MerchantScenario {
  /** Application ids by business name. */
  applications: Map<string, string>;
  merchantId?: string;
  merchantName?: string;
  approvedMerchantId?: string;
  staffApi?: ApiClient;
  adminApi?: ApiClient;
  /** Ids created by this scenario, by name. */
  items: Map<string, string>;
  drafts?: { category: string; name: string; description: string | null; priceCentavos: number }[];
  itemCountBefore?: number;
  categoryNamesBefore?: string[];
  /** Undo for changes to seeded stores, run after the scenario. */
  cleanups: (() => Promise<void>)[];
}

/** State for customer discovery, search and cart steps. */
export interface DiscoveryScenario {
  location?: { lat: number; lng: number };
  feed?: unknown;
  search?: unknown;
  quote?: unknown;
  itemIds?: Map<string, string>;
}

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

setDefaultTimeout(30_000);

let browser: Browser | undefined;

/** Per-scenario state: API client, database helper and a lazily created browser page. */
export class KlikWorld extends World {
  readonly api = new ApiClient(BASE_URL);
  readonly db = new DbHelper(process.env.DATABASE_URL);
  lastResponse: ApiResponse | undefined;
  responses: ApiResponse[] = [];
  /** Named people, places and orders created by @db steps. */
  readonly data = new ScenarioData();
  readonly auth: AuthScenario = {};
  readonly discovery: DiscoveryScenario = {};
  readonly merchant: MerchantScenario = { applications: new Map(), items: new Map(), cleanups: [] };
  private context: BrowserContext | undefined;
  private currentPage: Page | undefined;

  constructor(options: IWorldOptions) {
    super(options);
  }

  /** Opens (once per scenario) a real Chromium page so UI steps see what a customer sees. */
  async page(): Promise<Page> {
    if (!this.currentPage) {
      const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
      browser ??= await chromium.launch(executablePath ? { executablePath } : {});
      this.context = await browser.newContext({ baseURL: BASE_URL });
      this.currentPage = await this.context.newPage();
    }
    return this.currentPage;
  }

  /** The last HTTP response, failing loudly if a step forgot to make a request. */
  response(): ApiResponse {
    if (!this.lastResponse) throw new Error("No request has been made in this scenario yet.");
    return this.lastResponse;
  }

  /** Releases scenario resources. */
  async dispose(): Promise<void> {
    await this.context?.close();
    await this.db.close();
  }
}

setWorldConstructor(KlikWorld);

BeforeAll(function () {
  console.log(`Cucumber is testing ${BASE_URL}`);
});

Before({ tags: "@db" }, async function (this: KlikWorld) {
  await this.db.begin();
});

After(async function (this: KlikWorld) {
  for (const cleanup of this.merchant.cleanups.reverse()) await cleanup();
  await this.dispose();
});

AfterAll(async function () {
  await browser?.close();
});
