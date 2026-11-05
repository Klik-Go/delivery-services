import { z } from "zod";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/** A peso amount as typed by a merchant ("120", "1,299.50"). The service converts it to centavos. */
export const PesoAmountSchema = z
  .string()
  .trim()
  .regex(/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/, "Enter an amount like 120 or 120.50");

/** POST/PATCH category. */
export const MenuCategoryInputSchema = z.object({ name: text(1, 60) });

/** PUT /api/merchant/:merchantId/menu/categories/order — new order of every category. */
export const ReorderCategoriesSchema = z.object({
  categoryIds: z.array(z.uuid()).min(1).max(100),
});

/** One choice inside a modifier group ("Garlic rice +₱15"). */
export const ModifierOptionInputSchema = z.object({
  name: text(1, 60),
  priceDelta: PesoAmountSchema.default("0"),
});

/** A modifier group ("Rice", pick exactly 1). */
export const ModifierGroupInputSchema = z
  .object({
    name: text(1, 60),
    required: z.boolean().default(false),
    minSelect: z.number().int().min(0).max(20).default(0),
    maxSelect: z.number().int().min(1).max(20).default(1),
    options: z.array(ModifierOptionInputSchema).min(1).max(30),
  })
  .refine((group) => group.maxSelect >= group.minSelect, {
    message: "Maximum must be at least the minimum.",
    path: ["maxSelect"],
  })
  .refine((group) => !group.required || group.minSelect >= 1, {
    message: "A required group needs a minimum of at least 1.",
    path: ["minSelect"],
  })
  .refine((group) => group.minSelect <= group.options.length, {
    message: "The minimum is more than the number of options.",
    path: ["minSelect"],
  });
export type ModifierGroupInput = z.infer<typeof ModifierGroupInputSchema>;

/** Create or replace a menu item (with its modifier groups). */
export const MenuItemInputSchema = z.object({
  categoryId: z.uuid(),
  name: text(1, 120),
  description: text(0, 500).optional(),
  price: PesoAmountSchema,
  /** Storage path inside the menu-photos bucket, from an upload URL issued by the BFF. */
  photoPath: z
    .string()
    .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/)
    .nullable()
    .optional(),
  isAvailable: z.boolean().default(true),
  modifierGroups: z.array(ModifierGroupInputSchema).max(10).default([]),
});
export type MenuItemInput = z.infer<typeof MenuItemInputSchema>;
/** Form values before defaults are applied (React Hook Form's input type). */
export type MenuItemFormValues = z.input<typeof MenuItemInputSchema>;

/** PUT …/items/:itemId/availability — "sold out" toggle. */
export const ItemAvailabilitySchema = z.object({ isAvailable: z.boolean() });

/** Menu photos are WebP of at most 200 KB (Phase 3 acceptance; the bucket enforces it too). */
export const MAX_MENU_PHOTO_BYTES = 204_800;

/** POST …/menu/photos — ask for a one-time upload URL. */
export const PhotoUploadRequestSchema = z.object({
  contentType: z.literal("image/webp"),
  size: z.number().int().min(1).max(MAX_MENU_PHOTO_BYTES),
});

/** One item as reviewed by the merchant after an AI import, ready to save. */
export const MenuDraftItemSchema = z.object({
  category: text(1, 60),
  name: text(1, 120),
  description: text(0, 500).optional(),
  price: PesoAmountSchema,
});
export type MenuDraftItem = z.infer<typeof MenuDraftItemSchema>;

/** POST …/menu/import/confirm — the reviewed drafts the merchant chose to keep. */
export const ConfirmMenuImportSchema = z.object({
  items: z.array(MenuDraftItemSchema).min(1).max(200),
});

/** Photos accepted for AI menu import (before any resizing). */
export const MENU_IMPORT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_MENU_IMPORT_BYTES = 5 * 1024 * 1024;
