/** Structured context attached to a log line. Never put customer personal data here unredacted. */
export type LogContext = Record<string, unknown>;

/** Structured logger port; implemented by the pino adapter. */
export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Returns a logger that adds `bindings` (e.g. requestId) to every line. */
  child(bindings: LogContext): Logger;
}
