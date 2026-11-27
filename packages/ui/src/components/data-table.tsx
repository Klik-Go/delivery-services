import type { HTMLAttributes, JSX, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface DataTableProps extends HTMLAttributes<HTMLTableElement> {
  readonly caption: string;
  readonly children: ReactNode;
}

/**
 * Record-size register table. Wrap in a Sheet; horizontal scroll lives inside the panel.
 * Narrow viewports should drop columns — never shrink peso figures.
 */
export function DataTable({ caption, className, children, ...props }: DataTableProps): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className={cn("text-record w-full border-collapse text-left", className)} {...props}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function DataTableHead({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>): JSX.Element {
  return <thead className={cn("bg-sheet-alt", className)} {...props} />;
}

export function DataTableHeadCell({
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>): JSX.Element {
  return (
    <th
      className={cn(
        "text-label text-ink-muted px-3 py-2.5 font-medium tracking-wide uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function DataTableBody({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>): JSX.Element {
  return <tbody className={cn("bg-sheet", className)} {...props} />;
}

export function DataTableRow({
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement>): JSX.Element {
  return <tr className={cn("border-rule border-t", className)} {...props} />;
}

export function DataTableCell({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>): JSX.Element {
  return <td className={cn("text-ink px-3 py-2.5", className)} {...props} />;
}

export interface DataTableEmptyProps {
  readonly children: ReactNode;
}

/** Empty register: a sentence on its own ruled line. */
export function DataTableEmpty({ children }: DataTableEmptyProps): JSX.Element {
  return (
    <tr>
      <td colSpan={99} className="text-ink-muted border-rule border-t px-3 py-4">
        {children}
      </td>
    </tr>
  );
}
