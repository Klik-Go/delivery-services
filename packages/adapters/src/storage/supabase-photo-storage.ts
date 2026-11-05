import {
  err,
  ok,
  ServiceUnavailableError,
  type AppError,
  type IPhotoStorage,
  type Logger,
  type PhotoUpload,
  type Result,
} from "@klikgo/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The public bucket for menu photos (Phase 1 storage migration). */
export const MENU_PHOTOS_BUCKET = "menu-photos";

/**
 * Menu photos in Supabase Storage. The BFF (service role) issues one-time upload links for paths
 * it chose; the bucket itself only accepts WebP of at most 200 KB.
 */
export class SupabasePhotoStorage implements IPhotoStorage {
  constructor(
    private readonly client: SupabaseClient,
    private readonly logger: Logger,
  ) {}

  async createUpload(path: string): Promise<Result<PhotoUpload, AppError>> {
    const { data, error } = await this.client.storage
      .from(MENU_PHOTOS_BUCKET)
      .createSignedUploadUrl(path);
    if (error) {
      this.logger.error("storage.upload_url_failed", { path, message: error.message });
      return err(new ServiceUnavailableError("Photo uploads are not available right now."));
    }
    return ok({ path: data.path, uploadUrl: data.signedUrl, token: data.token });
  }

  publicUrl(path: string): string {
    return this.client.storage.from(MENU_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
  }
}
