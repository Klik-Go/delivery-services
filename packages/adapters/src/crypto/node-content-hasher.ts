import { createHash } from "node:crypto";
import type { IContentHasher } from "@klikgo/core";

/** SHA-256 with Node's crypto module. */
export class NodeContentHasher implements IContentHasher {
  sha256Hex(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
  }
}
