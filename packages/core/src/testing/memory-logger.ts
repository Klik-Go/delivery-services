import type { LogContext, Logger } from "../ports/logger";

/** One captured log line. */
export interface CapturedLog {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly context: LogContext;
}

/** Logger fake that records lines so tests can assert on them. */
export class MemoryLogger implements Logger {
  constructor(
    readonly lines: CapturedLog[] = [],
    private readonly bindings: LogContext = {},
  ) {}

  debug(message: string, context: LogContext = {}): void {
    this.record("debug", message, context);
  }

  info(message: string, context: LogContext = {}): void {
    this.record("info", message, context);
  }

  warn(message: string, context: LogContext = {}): void {
    this.record("warn", message, context);
  }

  error(message: string, context: LogContext = {}): void {
    this.record("error", message, context);
  }

  child(bindings: LogContext): Logger {
    return new MemoryLogger(this.lines, { ...this.bindings, ...bindings });
  }

  private record(level: CapturedLog["level"], message: string, context: LogContext): void {
    this.lines.push({ level, message, context: { ...this.bindings, ...context } });
  }
}
