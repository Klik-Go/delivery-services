import { NotFoundError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { MenuCategoryView, MenuService } from "./menu-service";
import type { IMenuRepository, IStorefrontRepository, Storefront } from "./ports";

/** The public page of a live store at /stores/:slug: its details and menu, read-only. */
export class StorefrontService {
  constructor(
    private readonly deps: {
      storefronts: IStorefrontRepository;
      menus: IMenuRepository;
      menuService: MenuService;
    },
  ) {}

  /** A live store and its menu (empty categories hidden), or NOT_FOUND. */
  async store(
    slug: string,
  ): Promise<Result<{ store: Storefront; menu: MenuCategoryView[] }, AppError>> {
    const store = await this.deps.storefronts.bySlug(slug);
    if (!store) return err(new NotFoundError("Store", slug));
    const categories = await this.deps.menus.menu(store.merchantId);
    const menu = this.deps.menuService
      .withPhotos(categories)
      .filter((category) => category.items.length > 0);
    return ok({ store, menu });
  }
}
