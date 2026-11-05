/** Stable, machine-readable error codes shared by services and the BFF. */
export type AppErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";

/** A field-level validation problem, e.g. from a zod parse. */
export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

/** Base class for expected domain failures. Transport mapping (HTTP status) lives in the BFF. */
export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Input failed validation. */
export class ValidationError extends AppError {
  constructor(
    message: string,
    readonly issues: readonly ValidationIssue[] = [],
  ) {
    super("VALIDATION_FAILED", message);
  }
}

/** The caller is not signed in. */
export class UnauthorizedError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super("UNAUTHORIZED", message);
  }
}

/** The caller is signed in but lacks the role or scope. */
export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this.") {
    super("FORBIDDEN", message);
  }
}

/** A referenced resource does not exist (or is hidden from the caller). */
export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super("NOT_FOUND", `${resource} ${id} was not found`);
  }
}

/** The request conflicts with current state, e.g. an invalid order status transition. */
export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message);
  }
}

/** Too many attempts; the caller should wait `retryAfterSeconds` before trying again. */
export class RateLimitedError extends AppError {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super("RATE_LIMITED", message);
  }
}

/** True for any expected domain error. */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
