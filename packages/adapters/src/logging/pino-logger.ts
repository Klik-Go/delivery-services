import type { LogContext, Logger } from "@klikgo/core";
import pino, { type DestinationStream, type Logger as Pino } from "pino";

/** Log levels we allow in configuration. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Options for {@link createPinoLogger}. */
export interface PinoLoggerOptions {
  readonly level: LogLevel;
  readonly service: string;
  /** Defaults to stdout; tests pass an in-memory stream. */
  readonly destination?: DestinationStream;
}

// Personal data (RA 10173) and credentials must never reach log storage.
const SENSITIVE_KEYS = [
  "phone",
  "email",
  "fullName",
  "full_name",
  "password",
  "otp",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "secret",
  "authorization",
  "cookie",
  "address",
  "landmark",
] as const;

const REDACT_PATHS = SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]);

/** pino-backed implementation of the core {@link Logger} port, emitting one JSON object per line. */
class PinoLogger implements Logger {
  constructor(private readonly pino: Pino) {}

  debug(message: string, context: LogContext = {}): void {
    this.pino.debug(context, message);
  }

  info(message: string, context: LogContext = {}): void {
    this.pino.info(context, message);
  }

  warn(message: string, context: LogContext = {}): void {
    this.pino.warn(context, message);
  }

  error(message: string, context: LogContext = {}): void {
    this.pino.error(context, message);
  }

  child(bindings: LogContext): Logger {
    return new PinoLogger(this.pino.child(bindings));
  }
}

/** Creates a structured JSON logger with PII redaction and ISO timestamps. */
export function createPinoLogger(options: PinoLoggerOptions): Logger {
  const instance = pino(
    {
      level: options.level,
      base: { service: options.service },
      messageKey: "msg",
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      serializers: { err: pino.stdSerializers.err },
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    },
    options.destination ?? pino.destination({ sync: false }),
  );
  return new PinoLogger(instance);
}
