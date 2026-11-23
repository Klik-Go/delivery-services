import { randomUUID } from "node:crypto";
import type { ErrorContext, IErrorReporter, Logger } from "@klikgo/core";

/** Where to send events, read from a Sentry DSN (https://<key>@<host>/<project>). */
export interface SentryTarget {
  readonly envelopeUrl: string;
  readonly publicKey: string;
  readonly dsn: string;
}

/** Parses a DSN; null for anything that is not an https DSN with a key and a project id. */
export function parseSentryDsn(dsn: string | undefined): SentryTarget | null {
  if (!dsn) return null;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const project = url.pathname.replace(/^\/+|\/+$/g, "");
  if (url.protocol !== "https:" || !url.username || !/^\d+$/.test(project)) return null;
  return {
    envelopeUrl: `https://${url.host}/api/${project}/envelope/`,
    publicKey: url.username,
    dsn,
  };
}

interface Frame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

/** V8 stack lines ("at fn (file:1:2)") into Sentry frames, oldest first. */
export function stackFrames(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n").slice(0, 50)) {
    const match = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!match) continue;
    const [, fn, file, lineNo, col] = match;
    frames.push({
      ...(fn ? { function: fn } : {}),
      ...(file ? { filename: file } : {}),
      lineno: Number(lineNo),
      colno: Number(col),
      in_app: !(file ?? "").includes("node_modules"),
    });
  }
  return frames.reverse();
}

/**
 * Sends errors to Sentry through its envelope API with fetch (no SDK in the bundle, no browser
 * script, no CSP change: browser errors reach Sentry through /api/client-errors). The core
 * service has already scrubbed personal data; this adapter adds no request bodies, cookies or IPs.
 */
export class SentryErrorReporter implements IErrorReporter {
  constructor(
    private readonly target: SentryTarget,
    private readonly options: {
      readonly environment: string;
      readonly release: string;
      readonly logger: Logger;
      readonly fetch?: typeof fetch;
      readonly timeoutMs?: number;
    },
  ) {}

  async capture(
    error: { readonly name: string; readonly message: string; readonly stack?: string },
    context: ErrorContext,
  ): Promise<void> {
    const eventId = randomUUID().replaceAll("-", "");
    const frames = stackFrames(error.stack);
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: context.source === "browser" ? "javascript" : "node",
      level: "error",
      environment: this.options.environment,
      release: this.options.release,
      logger: context.source,
      exception: {
        values: [
          {
            type: error.name,
            value: error.message,
            ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
          },
        ],
      },
      tags: {
        source: context.source,
        ...(context.route ? { route: context.route } : {}),
        ...(context.requestId ? { request_id: context.requestId } : {}),
        ...context.tags,
      },
      ...(context.userId ? { user: { id: context.userId } } : {}),
      ...(context.extra ? { extra: context.extra } : {}),
    };
    const body = [
      JSON.stringify({
        event_id: eventId,
        sent_at: new Date().toISOString(),
        dsn: this.target.dsn,
      }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n");
    const send = this.options.fetch ?? fetch;
    const response = await send(this.target.envelopeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${this.target.publicKey}, sentry_client=klikgo-bff/1.0`,
      },
      body,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 2_000),
    });
    if (!response.ok) {
      this.options.logger.warn("sentry.rejected", { status: response.status });
    }
  }
}

/** Without a DSN errors only go to the logs (which already have them). */
export class NoopErrorReporter implements IErrorReporter {
  capture(): Promise<void> {
    return Promise.resolve();
  }
}
