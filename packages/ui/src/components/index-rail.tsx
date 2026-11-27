import type { JSX, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface IndexRailEntry {
  readonly href: string;
  readonly label: string;
  readonly current?: boolean;
  /** Optional mono count pill. */
  readonly count?: string | number | undefined;
}

export interface IndexRailGroup {
  readonly heading: string;
  readonly entries: readonly IndexRailEntry[];
}

export interface IndexRailProps {
  readonly groups: readonly IndexRailGroup[];
  readonly className?: string | undefined;
  readonly renderLink: (entry: IndexRailEntry, className: string) => ReactNode;
}

/**
 * 16rem desk index rail. Group headings use mark size in masthead-muted.
 * Current entry inverts to a white chip with ink text and aria-current.
 */
export function IndexRail({ groups, className, renderLink }: IndexRailProps): JSX.Element {
  return (
    <nav
      aria-label="Sections"
      className={cn(
        "bg-masthead text-masthead-ink w-index hidden shrink-0 flex-col gap-5 px-3 py-4 lg:flex",
        className,
      )}
    >
      {groups.map((group) => (
        <div key={group.heading} className="flex flex-col gap-1">
          <p className="text-mark text-masthead-muted px-3 uppercase">{group.heading}</p>
          <ul className="flex flex-col gap-0.5">
            {group.entries.map((entry) => {
              const classNameEntry = cn(
                "text-record flex h-control min-h-control items-center justify-between gap-2 rounded-control px-3",
                entry.current
                  ? "bg-sheet text-masthead font-medium"
                  : "text-masthead-muted hover:bg-white/10 hover:text-masthead-ink",
              );
              return <li key={entry.href}>{renderLink(entry, classNameEntry)}</li>;
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export interface IndexRailDisclosureProps {
  readonly label: string;
  readonly groups: readonly IndexRailGroup[];
  readonly renderLink: (entry: IndexRailEntry, className: string) => ReactNode;
  readonly className?: string | undefined;
}

/**
 * Below `lg`, the same rail list lives in a native `<details>` in the masthead —
 * no JavaScript drawer required.
 */
export function IndexRailDisclosure({
  label,
  groups,
  renderLink,
  className,
}: IndexRailDisclosureProps): JSX.Element {
  return (
    <details className={cn("lg:hidden", className)}>
      <summary className="text-record text-masthead-ink h-tap min-h-tap rounded-control flex cursor-pointer list-none items-center px-3 hover:bg-white/10">
        {label}
      </summary>
      <div className="border-masthead-muted/30 mt-2 flex flex-col gap-4 border-t pt-3">
        {groups.map((group) => (
          <div key={group.heading} className="flex flex-col gap-1">
            <p className="text-mark text-masthead-muted px-3 uppercase">{group.heading}</p>
            <ul className="flex flex-col gap-0.5">
              {group.entries.map((entry) => {
                const classNameEntry = cn(
                  "text-record flex h-tap min-h-tap items-center justify-between gap-2 rounded-control px-3",
                  entry.current
                    ? "bg-sheet text-masthead font-medium"
                    : "text-masthead-muted hover:bg-white/10 hover:text-masthead-ink",
                );
                return <li key={entry.href}>{renderLink(entry, classNameEntry)}</li>;
              })}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
