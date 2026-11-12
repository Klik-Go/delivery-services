import {
  err,
  ok,
  ServiceUnavailableError,
  type AppError,
  type IKycStorage,
  type Logger,
  type Result,
} from "@klikgo/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The private bucket for rider documents (Phase 1 storage migration). */
export const RIDER_KYC_BUCKET = "rider-kyc";

/**
 * Rider documents in Supabase Storage (service role, server only). Riders upload through the BFF;
 * reviewers get links that expire after the given seconds. Nothing in the bucket is public.
 */
export class SupabaseKycStorage implements IKycStorage {
  constructor(
    private readonly client: SupabaseClient,
    private readonly logger: Logger,
  ) {}

  async signedUrl(path: string, seconds: number): Promise<Result<string, AppError>> {
    const { data, error } = await this.client.storage
      .from(RIDER_KYC_BUCKET)
      .createSignedUrl(path, seconds);
    if (error) {
      this.logger.error("storage.kyc_link_failed", { message: error.message });
      return err(new ServiceUnavailableError("The document can't be opened right now."));
    }
    return ok(data.signedUrl);
  }

  async upload(
    path: string,
    file: { readonly bytes: Uint8Array; readonly contentType: string },
  ): Promise<Result<void, AppError>> {
    const { error } = await this.client.storage
      .from(RIDER_KYC_BUCKET)
      .upload(path, file.bytes, { contentType: file.contentType, upsert: false });
    if (error) {
      this.logger.error("storage.kyc_upload_failed", { message: error.message });
      return err(new ServiceUnavailableError("The document couldn't be saved. Try again."));
    }
    return ok(undefined);
  }
}
