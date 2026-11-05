import { MAX_MENU_IMPORT_BYTES, MENU_IMPORT_IMAGE_TYPES } from "@klikgo/types";
import type { AuthorizationService } from "../auth/authorization-service";
import { authorize } from "../auth/authorize";
import type { IRateLimiter, RateLimitRule } from "../auth/ports";
import type { SessionUser } from "../auth/session-user";
import type { Logger } from "../ports/logger";
import { RateLimitedError, ValidationError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { IMenuParser, MenuImage, ParsedMenuItem } from "./ports";

/** Menu reading costs model quota: 10 photos per store per hour. */
export const MENU_IMPORTS_PER_STORE: RateLimitRule = { limit: 10, windowSeconds: 3600 };

/** Most items one photo can produce (a full menu board is well below this). */
export const MAX_IMPORTED_ITEMS = 200;

/**
 * "Import menu from photo": reads a menu photo into draft items for the merchant to review. It
 * never writes to the menu; confirmed drafts are saved by MenuService.importReviewedItems.
 * Only the menu photo goes to the parser: never customer data (CLAUDE.md, BUILD_PLAN §2 "AI").
 */
export class MenuImportService {
  constructor(
    private readonly deps: {
      parser: IMenuParser;
      rateLimiter: IRateLimiter;
      authz: AuthorizationService;
      logger: Logger;
    },
  ) {}

  /** Reads draft items from a menu photo. */
  async readMenuPhoto(
    user: SessionUser | null,
    merchantId: string,
    image: MenuImage,
  ): Promise<Result<ParsedMenuItem[], AppError>> {
    const allowed = authorize(this.deps.authz, user, { type: "merchant.manage", merchantId });
    if (!allowed.ok) return allowed;
    if (!MENU_IMPORT_IMAGE_TYPES.some((type) => type === image.mimeType)) {
      return err(new ValidationError("Upload a photo (JPEG, PNG or WebP) of your menu."));
    }
    if (image.data.byteLength === 0 || image.data.byteLength > MAX_MENU_IMPORT_BYTES) {
      return err(new ValidationError("The photo must be smaller than 5 MB."));
    }
    const limit = await this.deps.rateLimiter.hit(
      `menu-import:merchant:${merchantId}`,
      MENU_IMPORTS_PER_STORE,
    );
    if (!limit.allowed) {
      return err(
        new RateLimitedError(
          "You've imported many photos this hour. Please try again later.",
          limit.retryAfterSeconds,
        ),
      );
    }

    const parsed = await this.deps.parser.parse(image);
    if (!parsed.ok) return parsed;
    const drafts = parsed.value
      .filter((item) => item.name.trim() !== "" && Number.isSafeInteger(item.priceCentavos))
      .filter((item) => item.priceCentavos > 0)
      .slice(0, MAX_IMPORTED_ITEMS)
      .map((item) => ({
        category: item.category.trim() || "Menu",
        name: item.name.trim(),
        description: item.description?.trim() || null,
        priceCentavos: item.priceCentavos,
        confidence: Math.min(1, Math.max(0, item.confidence)),
      }));
    this.deps.logger.info("menu.import_read", { merchantId, drafts: drafts.length });
    return ok(drafts);
  }
}
