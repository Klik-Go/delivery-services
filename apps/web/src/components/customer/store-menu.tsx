"use client";

import { formatPeso } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { itemCount, useCart, type CartStore } from "@/lib/cart-store";
import { useHydrated } from "@/lib/use-hydrated";
import { BottomSheet } from "./bottom-sheet";

/** Menu shapes as the store page passes them in (centavos for money). */
export interface MenuOptionView {
  readonly id: string;
  readonly name: string;
  readonly priceDeltaCentavos: number;
  readonly isAvailable: boolean;
}
export interface MenuGroupView {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly minSelect: number;
  readonly maxSelect: number;
  readonly options: readonly MenuOptionView[];
}
export interface MenuItemView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceCentavos: number;
  readonly isAvailable: boolean;
  readonly photoUrl: string | null;
  readonly modifierGroups: readonly MenuGroupView[];
}
export interface MenuCategoryView {
  readonly id: string;
  readonly name: string;
  readonly items: readonly MenuItemView[];
}

const minFor = (group: MenuGroupView): number =>
  group.required ? Math.max(1, group.minSelect) : group.minSelect;

/** Store menu: sticky category tabs with scroll-spy, item rows, item sheet and the cart bar. */
export function StoreMenu({
  store,
  categories,
}: {
  readonly store: CartStore;
  readonly categories: readonly MenuCategoryView[];
}): JSX.Element {
  const t = useTranslations("Customer.store");
  const [active, setActive] = useState(categories[0]?.id ?? "");
  const [picked, setPicked] = useState<MenuItemView | null>(null);
  const sections = useRef(new Map<string, HTMLElement>());
  const tabs = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scroll-spy: the category nearest the top of the screen is the active tab.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = visible[0]?.target.getAttribute("data-category");
        if (id) setActive(id);
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    for (const element of sections.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    tabs.current
      ?.querySelector(`[data-tab="${active}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  return (
    <>
      <nav
        aria-label={t("menu")}
        className="border-brand-100 sticky top-0 z-10 -mx-4 border-b bg-white/95 px-4 backdrop-blur"
      >
        <div ref={tabs} className="flex gap-2 overflow-x-auto py-2">
          {categories.map((category) => (
            <a
              key={category.id}
              data-tab={category.id}
              href={`#c-${category.id}`}
              aria-current={active === category.id ? "true" : undefined}
              className={`min-h-tap inline-flex shrink-0 items-center rounded-full px-4 text-sm font-semibold ${active === category.id ? "bg-brand-800 text-white" : "bg-surface-muted text-ink"}`}
            >
              {category.name}
            </a>
          ))}
        </div>
      </nav>

      <div className="flex flex-col gap-6 pb-28">
        {categories.map((category) => (
          <section
            key={category.id}
            id={`c-${category.id}`}
            data-category={category.id}
            aria-labelledby={`h-${category.id}`}
            ref={(element) => {
              if (element) sections.current.set(category.id, element);
            }}
            className="flex scroll-mt-16 flex-col gap-2"
          >
            <h2 id={`h-${category.id}`} className="text-ink text-xl font-bold">
              {category.name}
            </h2>
            <ul className="flex flex-col gap-2">
              {category.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={!item.isAvailable}
                    onClick={() => setPicked(item)}
                    className="rounded-card border-brand-100 flex w-full items-center gap-3 border-2 p-3 text-left disabled:opacity-60"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-ink font-semibold">{item.name}</span>
                      {item.description ? (
                        <span className="text-ink-muted line-clamp-2 text-sm">
                          {item.description}
                        </span>
                      ) : null}
                      <span className="text-ink mt-1 font-semibold">
                        {formatPeso(item.priceCentavos)}
                      </span>
                      {!item.isAvailable ? (
                        <span className="bg-accent-400 text-ink mt-1 self-start rounded-full px-2 text-xs font-bold">
                          {t("soldOut")}
                        </span>
                      ) : null}
                    </span>
                    {item.photoUrl ? (
                      <Image
                        src={item.photoUrl}
                        alt=""
                        width={72}
                        height={72}
                        className="size-18 shrink-0 rounded-lg object-cover"
                      />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {picked ? <ItemSheet store={store} item={picked} onClose={() => setPicked(null)} /> : null}
      <CartBar />
    </>
  );
}

function ItemSheet({
  store,
  item,
  onClose,
}: {
  readonly store: CartStore;
  readonly item: MenuItemView;
  readonly onClose: () => void;
}): JSX.Element {
  const t = useTranslations("Customer.store");
  const add = useCart((state) => state.add);
  const replace = useCart((state) => state.replace);
  const cartStore = useCart((state) => state.store);
  const [chosen, setChosen] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      item.modifierGroups.map((group) => {
        // Preselect the first available option of single-choice required groups (common case).
        const first = group.options.find((o) => o.isAvailable);
        return [group.id, group.required && group.maxSelect === 1 && first ? [first.id] : []];
      }),
    ),
  );
  const [quantity, setQuantity] = useState(1);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const missing = item.modifierGroups.find(
    (group) => (chosen[group.id]?.length ?? 0) < minFor(group),
  );
  const optionIds = Object.values(chosen).flat();
  const optionNames = useMemo(
    () =>
      item.modifierGroups.flatMap((group) =>
        group.options.filter((o) => chosen[group.id]?.includes(o.id)).map((o) => o.name),
      ),
    [chosen, item.modifierGroups],
  );
  const unit =
    item.priceCentavos +
    item.modifierGroups.reduce(
      (sum, group) =>
        sum +
        group.options
          .filter((o) => chosen[group.id]?.includes(o.id))
          .reduce((s, o) => s + o.priceDeltaCentavos, 0),
      0,
    );

  function toggle(group: MenuGroupView, optionId: string): void {
    setChosen((current) => {
      const selected = current[group.id] ?? [];
      if (group.maxSelect === 1) return { ...current, [group.id]: [optionId] };
      if (selected.includes(optionId))
        return { ...current, [group.id]: selected.filter((id) => id !== optionId) };
      if (selected.length >= group.maxSelect) return current;
      return { ...current, [group.id]: [...selected, optionId] };
    });
  }

  const line = { itemId: item.id, name: item.name, optionIds, optionNames, quantity };
  function submit(): void {
    if (missing) return;
    if (add(store, line) === "replace") setConfirmReplace(true);
    else onClose();
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={confirmReplace ? t("replaceTitle") : item.name}
      closeLabel={t("close")}
      footer={
        confirmReplace ? (
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => {
                replace(store, line);
                onClose();
              }}
            >
              {t("replace")}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t("keep")}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1" role="group" aria-label={t("quantity")}>
              <Button
                variant="secondary"
                className="px-3"
                aria-label={t("decrease")}
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => q - 1)}
              >
                <Minus aria-hidden className="size-4" />
              </Button>
              <span className="text-ink w-8 text-center font-bold" aria-live="polite">
                {quantity}
              </span>
              <Button
                variant="secondary"
                className="px-3"
                aria-label={t("increase")}
                disabled={quantity >= 50}
                onClick={() => setQuantity((q) => q + 1)}
              >
                <Plus aria-hidden className="size-4" />
              </Button>
            </div>
            <Button className="flex-1" onClick={submit} disabled={missing !== undefined}>
              {missing
                ? t("choose", { group: missing.name })
                : `${t("add")} · ${formatPeso(unit * quantity)}`}
            </Button>
          </div>
        )
      }
    >
      {confirmReplace ? (
        <p className="text-ink">{t("replaceLead", { store: cartStore?.name ?? "" })}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {item.photoUrl ? (
            <Image
              src={item.photoUrl}
              alt=""
              width={640}
              height={360}
              className="aspect-video w-full rounded-xl object-cover"
            />
          ) : null}
          {item.description ? <p className="text-ink-muted">{item.description}</p> : null}
          {item.modifierGroups.map((group) => {
            const min = minFor(group);
            const rule =
              group.maxSelect === 1 && min === 1
                ? t("pickOne")
                : min === 0
                  ? t("pickUpTo", { max: group.maxSelect })
                  : t("pickBetween", { min, max: group.maxSelect });
            return (
              <fieldset key={group.id} className="flex flex-col gap-2">
                <legend className="text-ink flex w-full items-center justify-between font-bold">
                  {group.name}
                  <span className="text-ink-muted text-xs font-semibold">
                    {min > 0 ? `${t("required")} · ` : ""}
                    {rule}
                  </span>
                </legend>
                {group.options.map((option) => (
                  <label
                    key={option.id}
                    className={`min-h-tap flex items-center gap-3 rounded-xl px-2 ${option.isAvailable ? "" : "opacity-50"}`}
                  >
                    <input
                      type={group.maxSelect === 1 ? "radio" : "checkbox"}
                      name={group.id}
                      className="accent-brand-800 size-5"
                      disabled={!option.isAvailable}
                      checked={chosen[group.id]?.includes(option.id) ?? false}
                      onChange={() => toggle(group, option.id)}
                    />
                    <span className="text-ink flex-1">{option.name}</span>
                    {option.priceDeltaCentavos > 0 ? (
                      <span className="text-ink-muted text-sm">
                        +{formatPeso(option.priceDeltaCentavos)}
                      </span>
                    ) : null}
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
      )}
    </BottomSheet>
  );
}

/** Sticky "View cart" bar while the cart has items. */
export function CartBar(): JSX.Element | null {
  const t = useTranslations("Customer.store");
  const lines = useCart((state) => state.lines);
  // The cart lives in localStorage: render after hydration so server and client HTML agree.
  const mounted = useHydrated();
  const count = itemCount(lines);
  if (!mounted || count === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 px-4 pb-4">
      <Link
        href="/cart"
        className="bg-brand-800 mx-auto flex min-h-14 max-w-screen-sm items-center justify-between rounded-full px-5 font-semibold text-white shadow-lg"
      >
        <span className="inline-flex items-center gap-2">
          <ShoppingBag aria-hidden className="size-5" />
          {t("viewCart")}
        </span>
        <span>{t("items", { count })}</span>
      </Link>
    </div>
  );
}
