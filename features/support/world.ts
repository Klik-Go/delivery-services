import {
  After,
  AfterAll,
  BeforeAll,
  setDefaultTimeout,
  setWorldConstructor,
  World,
  type IWorldOptions,
} from "@cucumber/cucumber";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ApiClient, type ApiResponse } from "./api-client";
import { DbHelper } from "./db-helper";

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

setDefaultTimeout(30_000);

let browser: Browser | undefined;

/** Per-scenario state: API client, database helper and a lazily created browser page. */
export class KlikWorld extends World {
  readonly api = new ApiClient(BASE_URL);
  readonly db = new DbHelper(process.env.DATABASE_URL);
  lastResponse: ApiResponse | undefined;
  responses: ApiResponse[] = [];
  private context: BrowserContext | undefined;
  private currentPage: Page | undefined;

  constructor(options: IWorldOptions) {
    super(options);
  }

  /** Opens (once per scenario) a real Chromium page so UI steps see what a customer sees. */
  async page(): Promise<Page> {
    if (!this.currentPage) {
      browser ??= await chromium.launch();
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

After(async function (this: KlikWorld) {
  await this.dispose();
});

AfterAll(async function () {
  await browser?.close();
});
