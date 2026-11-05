import { describe, expect, it } from "vitest";
import {
  ConfirmMenuImportSchema,
  MenuItemInputSchema,
  ModifierGroupInputSchema,
  PhotoUploadRequestSchema,
} from "./menu";

const categoryId = "7b0c3a0e-4c4b-4f3e-9a51-2f3d1c6b8a10";

describe("menu schemas", () => {
  it("accepts an item priced in pesos with an optional rice choice", () => {
    const item = MenuItemInputSchema.parse({
      categoryId,
      name: "Chicken Adobo",
      price: "120.50",
      modifierGroups: [
        {
          name: "Rice",
          required: true,
          minSelect: 1,
          options: [{ name: "Plain rice" }, { name: "Garlic rice", priceDelta: "15" }],
        },
      ],
    });
    expect(item.isAvailable).toBe(true);
    expect(item.modifierGroups[0]?.options[0]?.priceDelta).toBe("0");
  });

  it("refuses prices that are not peso amounts", () => {
    for (const price of ["-5", "12.345", "abc", "₱120"])
      expect(MenuItemInputSchema.safeParse({ categoryId, name: "X", price }).success, price).toBe(
        false,
      );
  });

  it("refuses a required group with no minimum, or a minimum above the maximum", () => {
    const options = [{ name: "A" }, { name: "B" }];
    expect(
      ModifierGroupInputSchema.safeParse({ name: "G", required: true, minSelect: 0, options })
        .success,
    ).toBe(false);
    expect(
      ModifierGroupInputSchema.safeParse({ name: "G", minSelect: 2, maxSelect: 1, options })
        .success,
    ).toBe(false);
    expect(
      ModifierGroupInputSchema.safeParse({ name: "G", minSelect: 3, maxSelect: 3, options })
        .success,
    ).toBe(false);
  });

  it("only issues upload URLs for WebP photos of at most 200 KB", () => {
    expect(
      PhotoUploadRequestSchema.safeParse({ contentType: "image/webp", size: 150_000 }).success,
    ).toBe(true);
    expect(
      PhotoUploadRequestSchema.safeParse({ contentType: "image/jpeg", size: 150_000 }).success,
    ).toBe(false);
    expect(
      PhotoUploadRequestSchema.safeParse({ contentType: "image/webp", size: 300_000 }).success,
    ).toBe(false);
  });

  it("needs at least one reviewed item to confirm an import", () => {
    expect(ConfirmMenuImportSchema.safeParse({ items: [] }).success).toBe(false);
    expect(
      ConfirmMenuImportSchema.safeParse({
        items: [{ category: "Ulam", name: "Sinigang", price: "150" }],
      }).success,
    ).toBe(true);
  });
});
