"use client";

import { Button } from "@klikgo/ui";
import { useRouter } from "next/navigation";
import { useState, type JSX } from "react";
import { postJson } from "@/lib/post-json";

/** Signs out (revokes the session) and returns to Home. */
export function SignOutButton({ label }: { readonly label: string }): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void postJson("/api/auth/sign-out", {}, "").then(() => {
          router.replace("/");
          router.refresh();
        });
      }}
    >
      {label}
    </Button>
  );
}
