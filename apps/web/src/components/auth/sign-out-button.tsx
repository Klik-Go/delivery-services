"use client";

import { Button } from "@klikgo/ui";
import { useRouter } from "next/navigation";
import { useState, type JSX } from "react";
import { postJson } from "@/lib/post-json";

/** Signs out (revokes the session) and returns to Home. */
export function SignOutButton({
  label,
  variant = "secondary",
  className,
}: {
  readonly label: string;
  readonly variant?: "primary" | "secondary" | "ghost" | "destructive";
  readonly className?: string | undefined;
}): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      className={className}
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
