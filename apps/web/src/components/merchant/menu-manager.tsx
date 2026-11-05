"use client";

import { formatPeso } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type DragEvent, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { TextField } from "@/components/auth/text-field";
import { fetchData, requestJson } from "@/lib/post-json";
import { ItemEditor } from "./item-editor";
import type { MenuCategoryData, MenuItemData } from "./menu-types";

type Editing = { categoryId: string; item?: MenuItemData } | null;

/**
 * The menu manager: categories (reorder by drag or with the arrow buttons), items with prices in
 * pesos, sold-out toggles and an inline editor. Server state lives in TanStack Query.
 */
export function MenuManager({ merchantId }: { readonly merchantId: string }): JSX.Element {
  const t = useTranslations("Menu");
  const queryClient = useQueryClient();
  const key = ["menu", merchantId];
  const base = `/api/merchant/${merchantId}/menu`;
  const menu = useQuery({
    queryKey: key,
    queryFn: () => fetchData<MenuCategoryData[]>(base, t("loadFailed")),
  });
  const [newCategory, setNewCategory] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const mutate = useMutation({
    mutationFn: async (call: {
      method: "POST" | "PUT" | "PATCH" | "DELETE";
      path: string;
      body?: unknown;
    }) => {
      const result = await requestJson(call.method, `${base}${call.path}`, call.body, t("failed"));
      if (!result.ok) throw new Error(result.message);
      return result.data;
    },
    onMutate: () => setError(null),
    onError: (caught) => setError(caught.message),
    onSettled: () => void refresh(),
  });

  if (menu.isPending)
    return (
      <p className="text-ink-muted" aria-busy>
        {t("loading")}
      </p>
    );
  if (menu.isError)
    return (
      <div className="flex flex-col gap-3">
        <FormError message={menu.error.message} />
        <Button variant="secondary" className="self-start" onClick={() => void menu.refetch()}>
          {t("retry")}
        </Button>
      </div>
    );

  const categories = menu.data;
  const order = categories.map((category) => category.id);
  function reorder(ids: string[]): void {
    // Show the new order at once; the server confirms (or the refetch puts it back).
    queryClient.setQueryData<MenuCategoryData[]>(key, (current) =>
      ids
        .map((id) => current?.find((category) => category.id === id))
        .filter((category): category is MenuCategoryData => category !== undefined),
    );
    mutate.mutate({ method: "PUT", path: "/categories/order", body: { categoryIds: ids } });
  }
  function move(id: string, by: -1 | 1): void {
    const from = order.indexOf(id);
    const to = from + by;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, id);
    reorder(next);
  }
  function drop(event: DragEvent<HTMLElement>, targetId: string): void {
    event.preventDefault();
    if (!dragged || dragged === targetId) return;
    const next = order.filter((id) => id !== dragged);
    next.splice(next.indexOf(targetId), 0, dragged);
    setDragged(null);
    reorder(next);
  }

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newCategory.trim()) return;
          mutate.mutate({
            method: "POST",
            path: "/categories",
            body: { name: newCategory.trim() },
          });
          setNewCategory("");
        }}
      >
        <div className="min-w-48 flex-1">
          <TextField
            label={t("newCategory")}
            name="newCategory"
            placeholder="Silog Meals"
            maxLength={60}
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary">
          <Plus aria-hidden className="size-5" />
          {t("addCategory")}
        </Button>
      </form>
      <FormError message={error} />
      {categories.length === 0 ? <p className="text-ink-muted">{t("empty")}</p> : null}
      {categories.length > 1 ? <p className="text-ink-muted text-sm">{t("dragHint")}</p> : null}

      {categories.map((category, index) => (
        <section
          key={category.id}
          aria-labelledby={`category-${category.id}`}
          draggable
          onDragStart={() => setDragged(category.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => drop(event, category.id)}
          className="rounded-card border-brand-100 flex flex-col gap-3 border-2 p-4"
        >
          <header className="flex flex-wrap items-center gap-2">
            <GripVertical aria-hidden className="text-ink-muted size-5 cursor-grab" />
            {renaming?.id === category.id ? (
              <form
                className="flex flex-1 flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  mutate.mutate({
                    method: "PATCH",
                    path: `/categories/${category.id}`,
                    body: { name: renaming.name },
                  });
                  setRenaming(null);
                }}
              >
                <TextField
                  label={t("categoryName")}
                  name={`rename-${category.id}`}
                  value={renaming.name}
                  maxLength={60}
                  onChange={(event) => setRenaming({ id: category.id, name: event.target.value })}
                />
                <Button type="submit">{t("save")}</Button>
              </form>
            ) : (
              <h2
                id={`category-${category.id}`}
                className="text-ink min-w-0 flex-1 text-xl font-bold break-words"
              >
                {category.name}
              </h2>
            )}
            <div className="flex shrink-0">
              <Button
                variant="ghost"
                className="px-3"
                aria-label={t("moveUp", { name: category.name })}
                disabled={index === 0}
                onClick={() => move(category.id, -1)}
              >
                <ArrowUp aria-hidden className="size-5" />
              </Button>
              <Button
                variant="ghost"
                className="px-3"
                aria-label={t("moveDown", { name: category.name })}
                disabled={index === categories.length - 1}
                onClick={() => move(category.id, 1)}
              >
                <ArrowDown aria-hidden className="size-5" />
              </Button>
              <Button
                variant="ghost"
                className="px-3"
                aria-label={`${t("rename")}: ${category.name}`}
                onClick={() => setRenaming({ id: category.id, name: category.name })}
              >
                <Pencil aria-hidden className="size-5" />
              </Button>
              <Button
                variant="ghost"
                className="px-3"
                aria-label={`${t("delete")}: ${category.name}`}
                onClick={() => {
                  if (window.confirm(t("deleteCategoryConfirm", { name: category.name })))
                    mutate.mutate({ method: "DELETE", path: `/categories/${category.id}` });
                }}
              >
                <Trash2 aria-hidden className="size-5" />
              </Button>
            </div>
          </header>

          <ul className="flex flex-col gap-2">
            {category.items.map((item) =>
              editing?.item?.id === item.id ? (
                <li key={item.id}>
                  <ItemEditor
                    merchantId={merchantId}
                    categories={categories}
                    categoryId={category.id}
                    item={item}
                    onSaved={() => {
                      setEditing(null);
                      void refresh();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li
                  key={item.id}
                  className="bg-surface-muted flex items-center gap-3 rounded-xl p-3"
                >
                  {item.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Storage URLs, already small WebP
                    <img src={item.photoUrl} alt="" className="size-14 rounded-lg object-cover" />
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-col items-start">
                    <span className="text-ink font-semibold break-words">{item.name}</span>
                    <span className="text-ink-muted text-sm">
                      {formatPeso(item.priceCentavos)}
                      {item.modifierGroups.length > 0
                        ? ` · ${item.modifierGroups.map((group) => group.name).join(", ")}`
                        : ""}
                    </span>
                    {!item.isAvailable ? (
                      <span className="bg-accent-400 text-ink mt-1 rounded-full px-2 py-0.5 text-xs font-bold">
                        {t("soldOut")}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center">
                    <Button
                      variant="secondary"
                      className="px-3 text-sm"
                      onClick={() =>
                        mutate.mutate({
                          method: "PUT",
                          path: `/items/${item.id}/availability`,
                          body: { isAvailable: !item.isAvailable },
                        })
                      }
                    >
                      {item.isAvailable ? t("markSoldOut") : t("markAvailable")}
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-3"
                      aria-label={`${t("edit")}: ${item.name}`}
                      onClick={() => setEditing({ categoryId: category.id, item })}
                    >
                      <Pencil aria-hidden className="size-5" />
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
          {editing && !editing.item && editing.categoryId === category.id ? (
            <ItemEditor
              merchantId={merchantId}
              categories={categories}
              categoryId={category.id}
              onSaved={() => void refresh()}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <Button
              variant="ghost"
              className="self-start"
              onClick={() => setEditing({ categoryId: category.id })}
            >
              <Plus aria-hidden className="size-5" />
              {t("addItem")}
            </Button>
          )}
        </section>
      ))}
    </div>
  );
}
