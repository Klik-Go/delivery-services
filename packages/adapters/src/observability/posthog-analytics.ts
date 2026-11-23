import type { AnalyticsCapture, IAnalytics, Logger } from "@klikgo/core";

/**
 * Funnel events to PostHog's capture API from the server (no browser SDK, no cookies set by a third
 * party). Events carry an opaque id and ids of stores and orders only; GeoIP is disabled because
 * the IP PostHog would see is our server's.
 */
export class PostHogAnalytics implements IAnalytics {
  constructor(
    private readonly options: {
      readonly apiKey: string;
      readonly host: string;
      readonly logger: Logger;
      readonly fetch?: typeof fetch;
      readonly timeoutMs?: number;
    },
  ) {}

  async capture(event: AnalyticsCapture): Promise<void> {
    const send = this.options.fetch ?? fetch;
    const response = await send(`${this.options.host.replace(/\/$/, "")}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: this.options.apiKey,
        event: event.event,
        distinct_id: event.distinctId,
        timestamp: event.at.toISOString(),
        properties: {
          ...event.properties,
          $geoip_disable: true,
          $process_person_profile: false,
        },
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 2_000),
    });
    if (!response.ok) this.options.logger.warn("posthog.rejected", { status: response.status });
  }
}

/** Without a PostHog key nothing is counted. */
export class NoopAnalytics implements IAnalytics {
  capture(): Promise<void> {
    return Promise.resolve();
  }
}
