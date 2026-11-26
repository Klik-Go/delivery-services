import { randomUUID } from "node:crypto";
import {
  err,
  ok,
  ServiceUnavailableError,
  type AppError,
  type IReceiptStorage,
  type Logger,
  type Result,
} from "@klikgo/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The private bucket for Pabili receipt photos (Phase 13 migration). */
export const PABILI_RECEIPTS_BUCKET = "pabili-receipts";

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Pabili receipts, uploaded by the server (service role) to a private bucket at
 * `<order id>/<random>.<ext>`, and opened only through short-lived signed URLs handed out by
 * PabiliService to people allowed to see the order.
 */
export class SupabaseReceiptStorage implements IReceiptStorage {
  constructor(
    private readonly client: SupabaseClient,
    private readonly logger: Logger,
  ) {}

  async save(
    orderId: string,
    photo: { readonly bytes: Uint8Array; readonly contentType: string },
  ): Promise<Result<string, AppError>> {
    const ext = EXTENSIONS[photo.contentType] ?? "jpg";
    const path = `${orderId}/${randomUUID()}.${ext}`;
    const { error } = await this.client.storage
      .from(PABILI_RECEIPTS_BUCKET)
      .upload(path, photo.bytes, { contentType: photo.contentType, upsert: false });
    if (error) {
      this.logger.error("storage.receipt_upload_failed", { orderId, message: error.message });
      return err(new ServiceUnavailableError("The receipt photo couldn't be saved. Try again."));
    }
    return ok(path);
  }

  async signedUrl(path: string, expiresInSeconds: number): Promise<string | null> {
    const { data, error } = await this.client.storage
      .from(PABILI_RECEIPTS_BUCKET)
      .createSignedUrl(path, expiresInSeconds);
    if (error) {
      this.logger.warn("storage.receipt_sign_failed", { message: error.message });
      return null;
    }
    return data.signedUrl;
  }
}
