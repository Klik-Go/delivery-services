"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type JSX, type ReactNode } from "react";

/** TanStack Query for server state on interactive staff screens (CLAUDE.md "Next.js rules"). */
export function QueryProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
