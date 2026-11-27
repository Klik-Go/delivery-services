import { formatPeso } from "@klikgo/core";
import {
  Badge,
  BrandLogo,
  Button,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeadCell,
  DataTableRow,
  EmptyState,
  Masthead,
  OrderProgress,
  PhotoFallback,
  Price,
  Sheet,
  SheetSection,
  Skeleton,
  SkipLink,
  StatusMark,
  TextInput,
  TotalRow,
} from "@klikgo/ui";
import { CheckCircle2, Clock3, Truck } from "lucide-react";
import type { Metadata } from "next";
import type { JSX } from "react";

export const metadata: Metadata = {
  title: "UI kit",
  robots: { index: false },
};

/** Design-system story page for the operations-room primitives. Not linked from product nav. */
export default function DevUiPage(): JSX.Element {
  return (
    <div className="bg-canvas text-ink min-h-dvh">
      <SkipLink label="Skip to content" />
      <Masthead
        density="desk"
        brand={
          <div className="flex items-center gap-2">
            <BrandLogo size={36} decorative />
            <span className="font-display text-accent text-2xl tracking-wide">Klik Go</span>
          </div>
        }
        title="UI kit"
        meta="dev"
      />
      <main id="main" className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
        <p className="text-lede text-ink-muted max-w-prose">
          Role tokens, CVA primitives, and type ranks for the visual redesign. Behaviour and routes
          are unchanged — this page is a reference only.
        </p>

        <Sheet>
          <SheetSection first>
            <h2 className="text-title mb-4">Buttons</h2>
            <div className="flex flex-wrap gap-3">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button size="control">Desk 36px</Button>
            </div>
          </SheetSection>
          <SheetSection>
            <h2 className="text-title mb-4">Status marks</h2>
            <div className="flex flex-wrap gap-2">
              <StatusMark tone="action" icon={<Truck />} label="Assigned" />
              <StatusMark tone="awaiting" icon={<Clock3 />} label="Preparing" />
              <StatusMark tone="certified" icon={<CheckCircle2 />} label="Delivered" />
              <StatusMark tone="seal" icon={<Clock3 />} label="Cancelled" />
              <Badge tone="turmeric">Cash</Badge>
            </div>
          </SheetSection>
          <SheetSection>
            <h2 className="text-title mb-4">Field + price</h2>
            <div className="flex max-w-sm flex-col gap-3">
              <TextInput aria-label="Sample" placeholder="Mobile number" />
              <p className="text-body">
                Total <Price value={formatPeso(129_950)} className="text-ink ml-2 font-semibold" />
              </p>
              <TotalRow label="Order total" amount={formatPeso(129_950)} />
            </div>
          </SheetSection>
        </Sheet>

        <div className="grid gap-4 md:grid-cols-2">
          <Sheet className="overflow-hidden">
            <div className="aspect-[16/10]">
              <PhotoFallback name="Kusinang Kapampangan" />
            </div>
            <SheetSection>
              <h2 className="text-title">Photo fallback</h2>
              <p className="text-record text-ink-muted">
                Designed initial when a cover is missing.
              </p>
            </SheetSection>
          </Sheet>
          <EmptyState
            title="Your cart is empty"
            description="Find something to eat nearby."
            action={<Button>Browse stores</Button>}
          />
        </div>

        <Sheet>
          <SheetSection first>
            <h2 className="text-title mb-3">Register</h2>
            <DataTable caption="Sample orders">
              <DataTableHead>
                <tr>
                  <DataTableHeadCell>Code</DataTableHeadCell>
                  <DataTableHeadCell>Status</DataTableHeadCell>
                  <DataTableHeadCell className="text-right">Total</DataTableHeadCell>
                </tr>
              </DataTableHead>
              <DataTableBody>
                <DataTableRow>
                  <DataTableCell className="font-mono">KG-1042</DataTableCell>
                  <DataTableCell>
                    <StatusMark tone="awaiting" icon={<Clock3 />} label="Preparing" />
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <Price value={formatPeso(45_000)} />
                  </DataTableCell>
                </DataTableRow>
                <DataTableEmpty>No more rows.</DataTableEmpty>
              </DataTableBody>
            </DataTable>
          </SheetSection>
        </Sheet>

        <Sheet>
          <SheetSection first>
            <h2 className="text-title mb-4">Order progress</h2>
            <OrderProgress
              steps={[
                { id: "placed", label: "Placed", state: "done" },
                { id: "prep", label: "Preparing", state: "current" },
                { id: "ride", label: "On the way", state: "upcoming" },
                { id: "done", label: "Delivered", state: "upcoming" },
              ]}
            />
          </SheetSection>
        </Sheet>

        <div className="flex flex-col gap-2">
          <p className="text-label text-ink-muted uppercase">Skeleton</p>
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-24 w-full" rounded="panel" />
        </div>
      </main>
    </div>
  );
}
