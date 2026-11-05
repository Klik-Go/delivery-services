import type { MenuDraftItem, MenuItemInput } from "@klikgo/types";
import type { AuthorizationService } from "../auth/authorization-service";
import { authorize } from "../auth/authorize";
import type { SessionUser } from "../auth/session-user";
import type { Logger } from "../ports/logger";
import { NotFoundError, ValidationError, type AppError } from "../shared/errors";
import { pesosToCentavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import type {
  IMenuRepository,
  IPhotoStorage,
  MenuCategory,
  MenuItem,
  MenuItemDraft,
  PhotoUpload,
} from "./ports";

/** A menu item with its public photo URL. */
export interface MenuItemView extends MenuItem {
  readonly photoUrl: string | null;
}

/** A category with items ready to render. */
export interface MenuCategoryView extends Omit<MenuCategory, "items"> {
  readonly items: readonly MenuItemView[];
}

/**
 * The merchant's menu manager (docs/BUSINESS.md §9.2.2): categories, items priced in pesos and
 * stored in centavos, modifiers, photos and sold-out toggles. Every call is scoped to one store and
 * checked against the caller's roles.
 */
export class MenuService {
  constructor(
    private readonly deps: {
      menus: IMenuRepository;
      photos: IPhotoStorage;
      authz: AuthorizationService;
      logger: Logger;
      newId: () => string;
    },
  ) {}

  /** The whole menu of a store, as its team sees it. */
  async menu(
    user: SessionUser | null,
    merchantId: string,
  ): Promise<Result<MenuCategoryView[], AppError>> {
    const allowed = this.allow(user, merchantId);
    if (!allowed.ok) return allowed;
    return ok(this.withPhotos(await this.deps.menus.menu(merchantId)));
  }

  /** Adds photo URLs to a menu read from the repository (also used by the public store page). */
  withPhotos(categories: readonly MenuCategory[]): MenuCategoryView[] {
    return categories.map((category) => ({
      ...category,
      items: category.items.map((item) => ({
        ...item,
        photoUrl: item.photoPath ? this.deps.photos.publicUrl(item.photoPath) : null,
      })),
    }));
  }

  async createCategory(
    user: SessionUser | null,
    merchantId: string,
    name: string,
  ): Promise<Result<{ id: string }, AppError>> {
    const allowed = this.allow(user, merchantId);
    if (!allowed.ok) return allowed;
    return ok(await this.deps.menus.createCategory(merchantId, name));
  }

  async renameCategory(
    user: SessionUser | null,
    merchantId: string,
    categoryId: string,
    name: string,
  ): Promise<Result<void, AppError>> {
    const allowed = this.allow(user, merchantId);
    if (!allowed.ok) return allowed;
    return (await this.deps.menus.renameCategory(merchantId, categoryId, name))
      ? ok(undefined)
      : err(new NotFoundError("Category", categoryId));
  }

  /** Puts the categories in the given order (every category exactly once). */
  async reorderCategories(
    user: SessionUser | null,
    merchantId: string,
    categoryIds: readonly string[],
  ): Promise<Result<void, AppError>> {
    const allowed = this.allow(user, merchantId);
    if (!allowed.ok) return allowed;
    if (new Set(categoryIds).size !== categoryIds.length)
      return err(new ValidationError("Each category can appear only once."));
    return (await this.deps.menus.reorderCategories(merchantId, categoryIds))
      ? ok(undefined)
      : err(new ValidationError("Send every category of the menu exactly once."));
  }

  /** Deletes a category and the items in it. */
  async deleteCategory(
    user: SessionUser | null,
    merchantId: string,
    categoryId: string,
  ): Promise<Result<void, AppError>> {
    const allowed = this.allow(user, merchantId);
    if (!allowed.ok) return allowed;
    return (await this.deps.menus.deleteCategory(merchantId, categoryId))
      ? ok(undefined)
      : err(new NotFoundError("Category", categoryId));
  }

  async createItem(
    user: SessionUser | null,
    merchantId: string,
    input: MenuItemInput,
  ): Promise<Result<{ id: string }, AppError>> {
    const allowed = this.allow(user, merchantId);
    if (!allowed.ok) return allowed;
    const draft = await this.draft(merchantId, input);
    if (!draft.ok) return draft;
    const created = await this.deps.menus.createItem(merchantId, draft.value);
    return ok(created);
  }

  /** Replaces an item, including its modifier groups. */
  async updateItem(
    user: SessionUser | null,
    merchantId: string,
    itemId: string,
    input: MenuItemInput,
  ): Promise<Result<void, AppError>> {
    const allowed = this.allow(user, merchantId);
    if (!allowed.ok) return allowed;
    const draft = await this.draft(merchantId, input);
    if (!draft.ok) return draft;
    return (await this.deps.menus.replaceItem(merchantId, itemId, draft.value))
      ? ok(undefined)
      : err(new NotFoundError("Item", itemId));
  }

  /** Marks an item sold out (or available again). */
  async setAvailability(
    user: SessionUser | null,
    merchantId: string,
    itemId: string,
    isAvailable: boolean,
  ): Promise<Result<void, AppError>> {
    const allowed = this.allow(user, merchantId);
    if (!allowed.ok) return allowed;
    return (await this.deps.menus.setItemAvailability(merchantId, itemId, isAvailable))
      ? ok(undefined)
      : err(new NotFoundError("Item", itemId));
  }

  async deleteItem(
    user: SessionUser | null,
    merchantId: string,
    itemId: string,
  ): Promise<Result<void, AppError>> {
    const allowed = this.allow(user, merchantId);
    if (!allowed.ok) return allowed;
    return (await this.deps.menus.deleteItem(merchantId, itemId))
      ? ok(undefined)
      : err(new NotFoundError("Item", itemId));
  }

  /**
   * A one-time upload link for a photo in this store's folder. The schema already limited it to
   * WebP ≤ 200 KB; the bucket enforces the same limits on the upload itself.
   */
  async createPhotoUpload(
    user: SessionUser | null,
    merchantId: string,
  ): Promise<Result<PhotoUpload, AppError>> {
    const allowed = this.allow(user, merchantId);
    if (!allowed.ok) return allowed;
    return this.deps.photos.createUpload(`${merchantId}/${this.deps.newId()}.webp`);
  }

  /** Saves import drafts the merchant reviewed (AI import never writes without this step). */
  async importReviewedItems(
    user: SessionUser | null,
    merchantId: string,
    items: readonly MenuDraftItem[],
  ): Promise<Result<{ created: number; categoriesCreated: number }, AppError>> {
    const allowed = this.allow(user, merchantId);
    if (!allowed.ok) return allowed;
    const result = await this.deps.menus.importItems(
      merchantId,
      items.map((item) => ({
        category: item.category,
        name: item.name,
        description: item.description || null,
        priceCentavos: pesosToCentavos(item.price),
      })),
    );
    this.deps.logger.info("menu.import_confirmed", { merchantId, ...result });
    return ok(result);
  }

  private allow(user: SessionUser | null, merchantId: string) {
    return authorize(this.deps.authz, user, { type: "merchant.manage", merchantId });
  }

  private async draft(
    merchantId: string,
    input: MenuItemInput,
  ): Promise<Result<MenuItemDraft, ValidationError>> {
    if (!(await this.deps.menus.hasCategory(merchantId, input.categoryId))) {
      return err(
        new ValidationError("Choose one of your menu categories.", [
          { path: "categoryId", message: "Not a category of this store" },
        ]),
      );
    }
    const photoPath = input.photoPath ?? null;
    if (photoPath !== null && !photoPath.startsWith(`${merchantId}/`)) {
      return err(
        new ValidationError("That photo belongs to another store.", [
          { path: "photoPath", message: "Not in this store's folder" },
        ]),
      );
    }
    const priceCentavos = pesosToCentavos(input.price);
    if (priceCentavos <= 0) {
      return err(
        new ValidationError("The price must be more than ₱0.", [
          { path: "price", message: "Must be more than 0" },
        ]),
      );
    }
    return ok({
      categoryId: input.categoryId,
      name: input.name,
      description: input.description || null,
      priceCentavos,
      photoPath,
      isAvailable: input.isAvailable,
      modifierGroups: input.modifierGroups.map((group) => ({
        name: group.name,
        required: group.required,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        options: group.options.map((option) => ({
          name: option.name,
          priceDeltaCentavos: pesosToCentavos(option.priceDelta),
        })),
      })),
    });
  }
}
