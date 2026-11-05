import type { IMenuRepository, ImportedMenuItem, MenuCategory, MenuItemDraft } from "@klikgo/core";
import type { PrismaClient } from "@klikgo/db";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

function groupsCreate(item: MenuItemDraft) {
  return item.modifierGroups.map((group, groupSort) => ({
    name: group.name,
    is_required: group.required,
    min_select: group.minSelect,
    max_select: group.maxSelect,
    sort: groupSort,
    modifier_options: {
      create: group.options.map((option, optionSort) => ({
        name: option.name,
        price_delta_centavos: option.priceDeltaCentavos,
        sort: optionSort,
      })),
    },
  }));
}

/**
 * Menus through Prisma. Every write filters by merchant_id as well as the row id, so a request for
 * another store's row changes nothing (the composite category FK enforces the same in SQL).
 */
export class PrismaMenuRepository implements IMenuRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async menu(merchantId: string): Promise<MenuCategory[]> {
    const categories = await this.prisma.menu_categories.findMany({
      where: { merchant_id: merchantId, is_active: true },
      orderBy: [{ sort: "asc" }, { created_at: "asc" }],
      include: {
        menu_items: {
          orderBy: [{ sort: "asc" }, { created_at: "asc" }],
          include: {
            modifier_groups: {
              orderBy: { sort: "asc" },
              include: { modifier_options: { orderBy: { sort: "asc" } } },
            },
          },
        },
      },
    });
    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      sort: category.sort,
      items: category.menu_items.map((item) => ({
        id: item.id,
        categoryId: item.category_id,
        name: item.name,
        description: item.description,
        priceCentavos: item.price_centavos,
        isAvailable: item.is_available,
        photoPath: item.photo_path,
        modifierGroups: item.modifier_groups.map((group) => ({
          id: group.id,
          name: group.name,
          required: group.is_required,
          minSelect: group.min_select,
          maxSelect: group.max_select,
          options: group.modifier_options.map((option) => ({
            id: option.id,
            name: option.name,
            priceDeltaCentavos: option.price_delta_centavos,
            isAvailable: option.is_available,
          })),
        })),
      })),
    }));
  }

  async createCategory(merchantId: string, name: string): Promise<{ id: string }> {
    return this.prisma.$transaction((tx) => this.insertCategory(tx, merchantId, name));
  }

  async renameCategory(merchantId: string, categoryId: string, name: string): Promise<boolean> {
    const updated = await this.prisma.menu_categories.updateMany({
      where: { id: categoryId, merchant_id: merchantId },
      data: { name },
    });
    return updated.count > 0;
  }

  async reorderCategories(merchantId: string, categoryIds: readonly string[]): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.menu_categories.findMany({
        where: { merchant_id: merchantId },
        select: { id: true },
      });
      const same =
        current.length === categoryIds.length &&
        current.every((category) => categoryIds.includes(category.id));
      if (!same) return false;
      for (const [sort, id] of categoryIds.entries())
        await tx.menu_categories.updateMany({
          where: { id, merchant_id: merchantId },
          data: { sort },
        });
      return true;
    });
  }

  async deleteCategory(merchantId: string, categoryId: string): Promise<boolean> {
    const deleted = await this.prisma.menu_categories.deleteMany({
      where: { id: categoryId, merchant_id: merchantId },
    });
    return deleted.count > 0;
  }

  async hasCategory(merchantId: string, categoryId: string): Promise<boolean> {
    return (
      (await this.prisma.menu_categories.count({
        where: { id: categoryId, merchant_id: merchantId },
      })) > 0
    );
  }

  async createItem(merchantId: string, item: MenuItemDraft): Promise<{ id: string }> {
    return this.prisma.$transaction((tx) => this.insertItem(tx, merchantId, item));
  }

  async replaceItem(merchantId: string, itemId: string, item: MenuItemDraft): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.menu_items.updateMany({
        where: { id: itemId, merchant_id: merchantId },
        data: {
          category_id: item.categoryId,
          name: item.name,
          description: item.description,
          price_centavos: item.priceCentavos,
          photo_path: item.photoPath,
          is_available: item.isAvailable,
        },
      });
      if (updated.count === 0) return false;
      await tx.modifier_groups.deleteMany({ where: { menu_item_id: itemId } });
      for (const group of groupsCreate(item))
        await tx.modifier_groups.create({ data: { ...group, menu_item_id: itemId } });
      return true;
    });
  }

  async setItemAvailability(
    merchantId: string,
    itemId: string,
    isAvailable: boolean,
  ): Promise<boolean> {
    const updated = await this.prisma.menu_items.updateMany({
      where: { id: itemId, merchant_id: merchantId },
      data: { is_available: isAvailable },
    });
    return updated.count > 0;
  }

  async deleteItem(merchantId: string, itemId: string): Promise<boolean> {
    const deleted = await this.prisma.menu_items.deleteMany({
      where: { id: itemId, merchant_id: merchantId },
    });
    return deleted.count > 0;
  }

  async importItems(
    merchantId: string,
    items: readonly ImportedMenuItem[],
  ): Promise<{ created: number; categoriesCreated: number }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.menu_categories.findMany({
        where: { merchant_id: merchantId },
        select: { id: true, name: true },
      });
      const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));
      let categoriesCreated = 0;
      for (const item of items) {
        let categoryId = byName.get(item.category.toLowerCase());
        if (!categoryId) {
          categoryId = (await this.insertCategory(tx, merchantId, item.category)).id;
          byName.set(item.category.toLowerCase(), categoryId);
          categoriesCreated += 1;
        }
        await this.insertItem(tx, merchantId, {
          categoryId,
          name: item.name,
          description: item.description,
          priceCentavos: item.priceCentavos,
          photoPath: null,
          isAvailable: true,
          modifierGroups: [],
        });
      }
      return { created: items.length, categoriesCreated };
    });
  }

  private async insertCategory(tx: Tx, merchantId: string, name: string): Promise<{ id: string }> {
    const last = await tx.menu_categories.aggregate({
      where: { merchant_id: merchantId },
      _max: { sort: true },
    });
    return tx.menu_categories.create({
      data: { merchant_id: merchantId, name, sort: (last._max.sort ?? -1) + 1 },
      select: { id: true },
    });
  }

  private async insertItem(
    tx: Tx,
    merchantId: string,
    item: MenuItemDraft,
  ): Promise<{ id: string }> {
    const last = await tx.menu_items.aggregate({
      where: { merchant_id: merchantId, category_id: item.categoryId },
      _max: { sort: true },
    });
    return tx.menu_items.create({
      data: {
        merchant_id: merchantId,
        category_id: item.categoryId,
        name: item.name,
        description: item.description,
        price_centavos: item.priceCentavos,
        photo_path: item.photoPath,
        is_available: item.isAvailable,
        sort: (last._max.sort ?? -1) + 1,
        modifier_groups: { create: groupsCreate(item) },
      },
      select: { id: true },
    });
  }
}
