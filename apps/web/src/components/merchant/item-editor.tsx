"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { centavosToPesoInput } from "@klikgo/core";
import { MenuItemInputSchema, type MenuItemFormValues, type MenuItemInput } from "@klikgo/types";
import { Button } from "@klikgo/ui";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type JSX } from "react";
import { useFieldArray, useForm, type Control, type UseFormRegister } from "react-hook-form";
import { FormError } from "@/components/auth/form-error";
import { TextField } from "@/components/auth/text-field";
import { compressToWebp } from "@/lib/compress-image";
import { requestJson } from "@/lib/post-json";
import type { MenuItemData } from "./menu-types";

const inputClass =
  "border-ink-muted/40 focus:border-brand-800 text-ink min-h-tap rounded-xl border-2 bg-white px-3";

/** An item's form values from what the menu API returned. */
function toInput(item: MenuItemData): MenuItemInput {
  return {
    categoryId: item.categoryId,
    name: item.name,
    description: item.description ?? "",
    price: centavosToPesoInput(item.priceCentavos),
    photoPath: item.photoPath,
    isAvailable: item.isAvailable,
    modifierGroups: item.modifierGroups.map((group) => ({
      name: group.name,
      required: group.required,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      options: group.options.map((option) => ({
        name: option.name,
        priceDelta: centavosToPesoInput(option.priceDeltaCentavos),
      })),
    })),
  };
}

/**
 * Add or edit one menu item with its choices and photo. After adding, the form clears but keeps
 * the category so a merchant can enter many dishes quickly.
 */
export function ItemEditor({
  merchantId,
  categories,
  categoryId,
  item,
  onSaved,
  onCancel,
}: {
  readonly merchantId: string;
  readonly categories: readonly { id: string; name: string }[];
  readonly categoryId: string;
  readonly item?: MenuItemData | undefined;
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const t = useTranslations("Menu");
  const [error, setError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(item?.photoUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const empty: MenuItemInput = {
    categoryId,
    name: "",
    description: "",
    price: "",
    photoPath: null,
    isAvailable: true,
    modifierGroups: [],
  };
  const form = useForm<MenuItemFormValues, unknown, MenuItemInput>({
    resolver: standardSchemaResolver(MenuItemInputSchema),
    defaultValues: item ? toInput(item) : empty,
  });
  const groups = useFieldArray({ control: form.control, name: "modifierGroups" });
  const errors = form.formState.errors;

  async function uploadPhoto(file: File): Promise<void> {
    setUploading(true);
    setError(null);
    try {
      const webp = await compressToWebp(file);
      const link = await requestJson<{ path: string; uploadUrl: string }>(
        "POST",
        `/api/merchant/${merchantId}/menu/photos`,
        { contentType: "image/webp", size: webp.size },
        t("photoFailed"),
      );
      if (!link.ok) throw new Error(link.message);
      const upload = await fetch(link.data.uploadUrl, {
        method: "PUT",
        headers: { "content-type": "image/webp", "x-upsert": "false" },
        body: webp,
      });
      if (!upload.ok) throw new Error(t("photoFailed"));
      form.setValue("photoPath", link.data.path, { shouldDirty: true });
      setPhotoUrl(URL.createObjectURL(webp));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("photoFailed"));
    } finally {
      setUploading(false);
    }
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const result = item
      ? await requestJson(
          "PUT",
          `/api/merchant/${merchantId}/menu/items/${item.id}`,
          values,
          t("failed"),
        )
      : await requestJson("POST", `/api/merchant/${merchantId}/menu/items`, values, t("failed"));
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved();
    if (!item) {
      form.reset({ ...empty, categoryId: values.categoryId });
      setPhotoUrl(null);
      form.setFocus("name");
    }
  });

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      aria-label={item ? t("editItem") : t("addItem")}
      className="rounded-card border-brand-200 flex flex-col gap-3 border-2 bg-white p-4"
    >
      <TextField
        label={t("itemName")}
        error={errors.name?.message}
        autoFocus
        {...form.register("name")}
      />
      <TextField
        label={t("price")}
        inputMode="decimal"
        placeholder="120.00"
        error={errors.price?.message}
        {...form.register("price")}
      />
      <TextField
        label={t("description")}
        error={errors.description?.message}
        {...form.register("description")}
      />
      <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
        {t("category")}
        <select className={inputClass} {...form.register("categoryId")}>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob: previews and Storage URLs
          <img src={photoUrl} alt="" className="size-20 rounded-xl object-cover" />
        ) : null}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label={t("photo")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadPhoto(file);
            event.target.value = "";
          }}
        />
        <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={uploading}>
          <ImagePlus aria-hidden className="size-5" />
          {uploading ? t("photoUploading") : photoUrl ? t("changePhoto") : t("choosePhoto")}
        </Button>
        {photoUrl ? (
          <Button
            variant="ghost"
            onClick={() => {
              form.setValue("photoPath", null, { shouldDirty: true });
              setPhotoUrl(null);
            }}
          >
            {t("removePhoto")}
          </Button>
        ) : null}
      </div>
      <label className="text-ink min-h-tap flex items-center gap-2 font-semibold">
        <input
          type="checkbox"
          className="accent-brand-800 size-5"
          {...form.register("isAvailable")}
        />
        {t("available")}
      </label>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-ink font-bold">{t("choices")}</legend>
        {groups.fields.map((group, index) => (
          <ModifierGroupFields
            key={group.id}
            index={index}
            control={form.control}
            register={form.register}
            error={
              errors.modifierGroups?.[index]?.message ??
              errors.modifierGroups?.[index]?.minSelect?.message ??
              errors.modifierGroups?.[index]?.maxSelect?.message ??
              errors.modifierGroups?.[index]?.options?.message
            }
            groupNameError={errors.modifierGroups?.[index]?.name?.message}
            optionError={(option, field) =>
              errors.modifierGroups?.[index]?.options?.[option]?.[field]?.message
            }
            onRemove={() => groups.remove(index)}
          />
        ))}
        <Button
          variant="ghost"
          className="self-start"
          onClick={() =>
            groups.append({
              name: "",
              required: true,
              minSelect: 1,
              maxSelect: 1,
              options: [
                { name: "", priceDelta: "0" },
                { name: "", priceDelta: "0" },
              ],
            })
          }
        >
          <Plus aria-hidden className="size-5" />
          {t("addGroup")}
        </Button>
      </fieldset>

      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={form.formState.isSubmitting || uploading}>
          {form.formState.isSubmitting ? t("saving") : t("save")}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function ModifierGroupFields({
  index,
  control,
  register,
  error,
  groupNameError,
  optionError,
  onRemove,
}: {
  readonly index: number;
  readonly control: Control<MenuItemFormValues, unknown, MenuItemInput>;
  readonly register: UseFormRegister<MenuItemFormValues>;
  readonly error: string | undefined;
  readonly groupNameError: string | undefined;
  readonly optionError: (option: number, field: "name" | "priceDelta") => string | undefined;
  readonly onRemove: () => void;
}): JSX.Element {
  const t = useTranslations("Menu");
  const options = useFieldArray({ control, name: `modifierGroups.${index}.options` });
  return (
    <div className="bg-surface-muted flex flex-col gap-2 rounded-xl p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
        <TextField
          label={t("groupName")}
          placeholder="Rice"
          error={groupNameError}
          {...register(`modifierGroups.${index}.name`)}
        />
        <Button variant="ghost" className="px-3" onClick={onRemove} aria-label={t("removeGroup")}>
          <Trash2 aria-hidden className="size-5" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-ink min-h-tap flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            className="accent-brand-800 size-5"
            {...register(`modifierGroups.${index}.required`)}
          />
          {t("required")}
        </label>
        <label className="text-ink flex items-center gap-2 text-sm">
          {t("min")}
          <input
            type="number"
            min={0}
            max={20}
            className={`${inputClass} w-20`}
            {...register(`modifierGroups.${index}.minSelect`, { valueAsNumber: true })}
          />
        </label>
        <label className="text-ink flex items-center gap-2 text-sm">
          {t("max")}
          <input
            type="number"
            min={1}
            max={20}
            className={`${inputClass} w-20`}
            {...register(`modifierGroups.${index}.maxSelect`, { valueAsNumber: true })}
          />
        </label>
      </div>
      {options.fields.map((option, optionIndex) => (
        <div key={option.id} className="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] items-end gap-2">
          <TextField
            label={t("optionName")}
            error={optionError(optionIndex, "name")}
            {...register(`modifierGroups.${index}.options.${optionIndex}.name`)}
          />
          <TextField
            label={t("optionPrice")}
            inputMode="decimal"
            error={optionError(optionIndex, "priceDelta")}
            {...register(`modifierGroups.${index}.options.${optionIndex}.priceDelta`)}
          />
          <Button
            variant="ghost"
            className="px-3"
            onClick={() => options.remove(optionIndex)}
            aria-label={t("removeOption")}
            disabled={options.fields.length <= 1}
          >
            <Trash2 aria-hidden className="size-5" />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        className="self-start"
        onClick={() => options.append({ name: "", priceDelta: "0" })}
      >
        <Plus aria-hidden className="size-5" />
        {t("addOption")}
      </Button>
      {error ? <p className="text-danger-900 text-sm">{error}</p> : null}
    </div>
  );
}
