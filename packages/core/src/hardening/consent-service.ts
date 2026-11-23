import {
  LEGAL_DOCUMENTS,
  LEGAL_VERSIONS,
  type ConsentAccept,
  type LegalDocument,
} from "@klikgo/types";
import type { SessionUser } from "../auth/session-user";
import { UnauthorizedError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { ConsentRecord, IConsentRepository } from "./ports";

/** What the consent screen shows. */
export interface ConsentStatus {
  readonly current: Readonly<Record<LegalDocument, string>>;
  /** Documents whose current version the person has not agreed to yet. */
  readonly needed: readonly LegalDocument[];
  readonly accepted: readonly ConsentRecord[];
}

/** Where the consent screen lives; `next` is where to go afterwards. */
export const CONSENT_PATH = "/consent";

/**
 * Agreement to the terms and the privacy notice (RA 10173: consent must be freely given, specific
 * and recorded). The server decides who still has to agree, so a new version of a document asks
 * everyone again on their next sign-in.
 */
export class ConsentService {
  constructor(private readonly deps: { consents: IConsentRepository }) {}

  /** Documents whose current version this person has not agreed to. */
  async missing(userId: string): Promise<LegalDocument[]> {
    const records = await this.deps.consents.forUser(userId);
    return LEGAL_DOCUMENTS.filter(
      (document) =>
        !records.some((r) => r.document === document && r.version === LEGAL_VERSIONS[document]),
    );
  }

  /** Where to send someone who just signed in: the consent screen first, if they still have to agree. */
  async landingFor(userId: string, next: string): Promise<string> {
    if ((await this.missing(userId)).length === 0) return next;
    return `${CONSENT_PATH}?${new URLSearchParams({ next: safeNext(next) }).toString()}`;
  }

  async status(user: SessionUser | null): Promise<Result<ConsentStatus, AppError>> {
    if (!user) return err(new UnauthorizedError());
    const accepted = await this.deps.consents.forUser(user.id);
    return ok({ current: LEGAL_VERSIONS, needed: await this.missing(user.id), accepted });
  }

  async accept(
    user: SessionUser | null,
    input: ConsentAccept,
  ): Promise<Result<{ readonly accepted: readonly LegalDocument[] }, AppError>> {
    if (!user) return err(new UnauthorizedError());
    await this.deps.consents.record(user.id, [
      { document: "terms", version: input.terms },
      { document: "privacy", version: input.privacy },
    ]);
    return ok({ accepted: LEGAL_DOCUMENTS });
  }
}

/** Only same-site paths survive as `next` (no open redirects through the consent screen). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next.slice(0, 200);
}
