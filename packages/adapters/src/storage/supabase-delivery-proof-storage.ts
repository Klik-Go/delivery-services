import { randomUUID } from "node:crypto";
import {
  err,
  ok,
  ServiceUnavailableError,
  type AppError,
  type IDeliveryProofStorage,
  type Logger,
  type Result,
} from "@klikgo/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The private bucket for delivery photos (Phase 7 migration). */
export const DELIVERY_PROOFS_BUCKET = "delivery-proofs";

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Delivery photos, uploaded by the server (service role) to a private bucket at
 * `<order id>/<random>.<ext>`. Nobody reads them directly; support opens them through short-lived
 * signed URLs (Phase 8 console).
 */
export class SupabaseDeliveryProofStorage implements IDeliveryProofStorage {
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
      .from(DELIVERY_PROOFS_BUCKET)
      .upload(path, photo.bytes, { contentType: photo.contentType, upsert: false });
    if (error) {
      this.logger.error("storage.proof_upload_failed", { orderId, message: error.message });
      return err(new ServiceUnavailableError("The photo couldn't be saved. Try again."));
    }
    return ok(path);
  }
}
