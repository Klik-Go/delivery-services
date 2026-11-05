import { MemoryLogger } from "@klikgo/core/testing";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabasePhotoStorage } from "./supabase-photo-storage";

function clientWith(bucket: Record<string, unknown>): {
  client: SupabaseClient;
  from: ReturnType<typeof vi.fn>;
} {
  const from = vi.fn().mockReturnValue(bucket);
  return { client: { storage: { from } } as unknown as SupabaseClient, from };
}

describe("SupabasePhotoStorage", () => {
  it("issues one-time upload links in the menu-photos bucket", async () => {
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: { path: "m/p.webp", signedUrl: "https://x.test/upload?token=t", token: "t" },
      error: null,
    });
    const { client, from } = clientWith({ createSignedUploadUrl });
    const result = await new SupabasePhotoStorage(client, new MemoryLogger()).createUpload(
      "m/p.webp",
    );
    expect(from).toHaveBeenCalledWith("menu-photos");
    expect(result).toEqual({
      ok: true,
      value: { path: "m/p.webp", uploadUrl: "https://x.test/upload?token=t", token: "t" },
    });
  });

  it("reports uploads as unavailable when Storage refuses", async () => {
    const createSignedUploadUrl = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "nope" } });
    const { client } = clientWith({ createSignedUploadUrl });
    const result = await new SupabasePhotoStorage(client, new MemoryLogger()).createUpload(
      "m/p.webp",
    );
    expect(!result.ok && result.error.code).toBe("UNAVAILABLE");
  });

  it("builds public photo URLs", () => {
    const getPublicUrl = vi
      .fn()
      .mockReturnValue({ data: { publicUrl: "https://x.test/m/p.webp" } });
    const { client } = clientWith({ getPublicUrl });
    expect(new SupabasePhotoStorage(client, new MemoryLogger()).publicUrl("m/p.webp")).toBe(
      "https://x.test/m/p.webp",
    );
  });
});
