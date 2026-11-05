"use client";

import { formatPeso, type SearchGroup } from "@klikgo/core";
import { MERCHANT_CATEGORIES } from "@klikgo/types";
import { Button } from "@klikgo/ui";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { fetchData } from "@/lib/post-json";
import { BottomSheet } from "./bottom-sheet";
import { StoreCard } from "./store-card";

const RECENT_KEY = "klikgo-recent-searches";

function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string").slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

interface Filters {
  category: string;
  openNow: boolean;
  sort: "relevance" | "distance";
}

/** Search stores and dishes near the delivery pin, with recent searches and a filters sheet. */
export function SearchView({
  hasLocation,
  initialCategory,
}: {
  readonly hasLocation: boolean;
  readonly initialCategory: string | null;
}): JSX.Element {
  const t = useTranslations("Customer.search");
  const tStore = useTranslations("Customer.store");
  const tCategories = useTranslations("Customer.categories");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    category: initialCategory ?? "",
    openNow: false,
    sort: "relevance",
  });

  useEffect(() => {
    // localStorage is only readable after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(readRecent());
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const params = new URLSearchParams({
    q,
    sort: filters.sort,
    ...(filters.openNow ? { openNow: "true" } : {}),
    ...(filters.category ? { category: filters.category } : {}),
  });
  const results = useQuery({
    queryKey: ["search", params.toString()],
    enabled: hasLocation && q.length > 0,
    queryFn: () =>
      fetchData<SearchGroup[]>(`/api/search?${params.toString()}`, t("noResults", { q })),
  });

  useEffect(() => {
    if (!results.isSuccess || q.length < 2) return;
    const next = [q, ...readRecent().filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(
      0,
      8,
    );
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Private mode: recent searches simply are not kept.
    }
  }, [results.isSuccess, q]);

  if (!hasLocation)
    return (
      <Link href="/address" className="text-brand-800 font-semibold underline">
        {t("needAddress")}
      </Link>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-2">
        <label className="text-ink flex flex-1 flex-col gap-1 text-sm font-semibold">
          <span className="sr-only">{t("label")}</span>
          <span className="relative">
            <SearchIcon
              aria-hidden
              className="text-ink-muted absolute top-1/2 left-3 size-5 -translate-y-1/2"
            />
            <input
              type="search"
              autoFocus
              value={text}
              placeholder={t("label")}
              onChange={(event) => setText(event.target.value)}
              className="border-ink-muted/40 focus:border-brand-800 text-ink min-h-tap w-full rounded-full border-2 pr-3 pl-10"
            />
          </span>
        </label>
        <Button variant="secondary" onClick={() => setFiltersOpen(true)} aria-label={t("filters")}>
          <SlidersHorizontal aria-hidden className="size-5" />
        </Button>
      </div>

      {q.length === 0 && recent.length > 0 ? (
        <section aria-labelledby="recent-heading" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 id="recent-heading" className="text-ink font-bold">
              {t("recent")}
            </h2>
            <button
              type="button"
              className="text-brand-800 min-h-tap px-2 text-sm font-semibold"
              onClick={() => {
                setRecent([]);
                try {
                  localStorage.removeItem(RECENT_KEY);
                } catch {
                  // Nothing to clear.
                }
              }}
            >
              {t("clearRecent")}
            </button>
          </div>
          <ul className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <li key={r}>
                <button
                  type="button"
                  onClick={() => setText(r)}
                  className="bg-surface-muted text-ink min-h-tap rounded-full px-4 text-sm"
                >
                  {r}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {results.isError ? <FormError message={results.error.message} /> : null}
      {results.isFetching && !results.data ? (
        <p className="text-ink-muted" aria-busy>
          {t("title")}…
        </p>
      ) : null}
      {results.data && results.data.length === 0 ? (
        <p className="text-ink-muted">{t("noResults", { q })}</p>
      ) : null}
      <ul className="flex flex-col gap-4">
        {results.data?.map((group) => (
          <li key={group.store.merchantId} className="flex flex-col gap-2">
            <StoreCard store={group.store} />
            {group.dishes.length > 0 ? (
              <ul
                aria-label={`${t("dishes")}: ${group.store.name}`}
                className="flex flex-col gap-1 pl-2"
              >
                {group.dishes.map((dish) => (
                  <li key={dish.itemId}>
                    <Link
                      href={`/s/${group.store.slug}`}
                      className="text-ink min-h-tap hover:bg-brand-50 flex items-center justify-between rounded-xl px-2"
                    >
                      <span>{dish.name}</span>
                      <span className="text-ink-muted text-sm">
                        {dish.isAvailable ? formatPeso(dish.priceCentavos) : tStore("soldOut")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      <BottomSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={t("filters")}
        closeLabel={tStore("close")}
        footer={
          <Button className="w-full" onClick={() => setFiltersOpen(false)}>
            {t("apply")}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-ink font-bold">{t("category")}</legend>
            {["", ...MERCHANT_CATEGORIES].map((category) => (
              <label key={category || "any"} className="min-h-tap flex items-center gap-3">
                <input
                  type="radio"
                  name="category"
                  className="accent-brand-800 size-5"
                  checked={filters.category === category}
                  onChange={() => setFilters((f) => ({ ...f, category }))}
                />
                {category ? tCategories(category) : t("any")}
              </label>
            ))}
          </fieldset>
          <label className="min-h-tap text-ink flex items-center gap-3 font-semibold">
            <input
              type="checkbox"
              className="accent-brand-800 size-5"
              checked={filters.openNow}
              onChange={(e) => setFilters((f) => ({ ...f, openNow: e.target.checked }))}
            />
            {t("openNow")}
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-ink font-bold">{t("sort")}</legend>
            {(["relevance", "distance"] as const).map((sort) => (
              <label key={sort} className="min-h-tap flex items-center gap-3">
                <input
                  type="radio"
                  name="sort"
                  className="accent-brand-800 size-5"
                  checked={filters.sort === sort}
                  onChange={() => setFilters((f) => ({ ...f, sort }))}
                />
                {t(sort)}
              </label>
            ))}
          </fieldset>
        </div>
      </BottomSheet>
    </div>
  );
}
