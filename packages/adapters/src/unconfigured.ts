import {
  err,
  ServiceUnavailableError,
  type AppError,
  type IDeliveryProofStorage,
  type IReceiptStorage,
  type IAccountAuthAdmin,
  type IKycFileRemover,
  type IKycStorage,
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

/** Delivery photos without the service-role key: riders are told to use the PIN or try later. */
export class UnconfiguredDeliveryProofStorage implements IDeliveryProofStorage {
  save(): Promise<Result<string, AppError>> {
    return Promise.resolve(
      err(new ServiceUnavailableError("Delivery photos aren't set up yet. Ask support for help.")),
    );
  }
}

/** Pabili receipts without the service-role key: recording a purchase says so instead of failing. */
export class UnconfiguredReceiptStorage implements IReceiptStorage {
  save(): Promise<Result<string, AppError>> {
    return Promise.resolve(
      err(new ServiceUnavailableError("Receipt photos aren't set up yet. Ask support for help.")),
    );
  }

  signedUrl(): Promise<string | null> {
    return Promise.resolve(null);
  }
}

/** Rider documents without the service-role key: uploads and review links say so instead of failing. */
export class UnconfiguredKycStorage implements IKycStorage, IKycFileRemover {
  signedUrl(): Promise<Result<string, AppError>> {
    return Promise.resolve(err(new ServiceUnavailableError("Rider documents aren't set up yet.")));
  }

  upload(): Promise<Result<void, AppError>> {
    return Promise.resolve(err(new ServiceUnavailableError("Rider documents aren't set up yet.")));
  }

  /** Nothing can be deleted without storage; the retention job retries on its next run. */
  remove(): Promise<Result<void, AppError>> {
    return Promise.resolve(err(new ServiceUnavailableError("Rider documents aren't set up yet.")));
  }
}

/** Without the service-role key accounts cannot be erased on the Supabase Auth side. */
export class UnconfiguredAccountAuthAdmin implements IAccountAuthAdmin {
  softDelete(): Promise<Result<void, AppError>> {
    return Promise.resolve(
      err(new ServiceUnavailableError("Account deletion isn't set up yet. Contact support.")),
    );
  }
}
