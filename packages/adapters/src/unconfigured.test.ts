import { describe, expect, it } from "vitest";
import {
  UnconfiguredDeliveryProofStorage,
  UnconfiguredMenuParser,
  UnconfiguredPhotoStorage,
} from "./unconfigured";

describe("unconfigured adapters", () => {
  it("say menu import and uploads are not set up yet instead of failing", async () => {
    const parsed = await new UnconfiguredMenuParser().parse();
    const upload = await new UnconfiguredPhotoStorage(undefined).createUpload();
    expect(!parsed.ok && parsed.error.code).toBe("UNAVAILABLE");
    expect(!upload.ok && upload.error.code).toBe("UNAVAILABLE");
    const proof = await new UnconfiguredDeliveryProofStorage().save();
    expect(!proof.ok && proof.error.code).toBe("UNAVAILABLE");
  });

  it("still builds public photo URLs from the project URL", () => {
    expect(new UnconfiguredPhotoStorage("https://abc.supabase.co/").publicUrl("m/p.webp")).toBe(
      "https://abc.supabase.co/storage/v1/object/public/menu-photos/m/p.webp",
    );
  });
});
