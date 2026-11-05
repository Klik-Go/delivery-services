import {
  err,
  ServiceUnavailableError,
  type AppError,
  type IMenuParser,
  type IPhotoStorage,
  type ParsedMenuItem,
  type PhotoUpload,
  type Result,
} from "@klikgo/core";

/**
 * Menu reading when no Gemini key is configured: every call answers "not set up yet" (503) instead
 * of throwing, so the import page explains the situation (honours the IMenuParser contract).
 */
export class UnconfiguredMenuParser implements IMenuParser {
  parse(): Promise<Result<ParsedMenuItem[], AppError>> {
    return Promise.resolve(
      err(new ServiceUnavailableError("Menu import from a photo isn't set up yet.")),
    );
  }
}

/**
 * Photo storage without the Supabase service-role key: uploads are unavailable; public URLs still
 * resolve against the project URL so existing photos keep showing.
 */
export class UnconfiguredPhotoStorage implements IPhotoStorage {
  constructor(private readonly supabaseUrl: string | undefined) {}

  createUpload(): Promise<Result<PhotoUpload, AppError>> {
    return Promise.resolve(err(new ServiceUnavailableError("Photo uploads aren't set up yet.")));
  }

  publicUrl(path: string): string {
    const base = this.supabaseUrl?.replace(/\/$/, "") ?? "";
    return `${base}/storage/v1/object/public/menu-photos/${path}`;
  }
}
