import { describe, expect, it } from "vitest";
import { AuthorizationService } from "../auth/authorization-service";
import { AppError } from "../shared/errors";
import { err, ok } from "../shared/result";
import { FakeMenuParser, InMemoryRateLimiter, MemoryLogger, sessionUser } from "../testing";
import { MenuImportService } from "./menu-import-service";

const STORE = "merchant-a";
const owner = sessionUser("owner-a", [{ role: "merchant_owner", merchantId: STORE }]);
const photo = { data: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };

function setup() {
  const parser = new FakeMenuParser();
  const service = new MenuImportService({
    parser,
    rateLimiter: new InMemoryRateLimiter(),
    authz: new AuthorizationService(),
    logger: new MemoryLogger(),
  });
  return { parser, service };
}

describe("MenuImportService", () => {
  it("turns a menu photo into drafts with prices in centavos and a confidence", async () => {
    const { service } = setup();
    const drafts = await service.readMenuPhoto(owner, STORE, photo);
    expect(drafts.ok && drafts.value[0]).toEqual({
      category: "Ulam",
      name: "Chicken Adobo",
      description: "With rice",
      priceCentavos: 12000,
      confidence: 0.96,
    });
  });

  it("drops rows without a name or a positive price and clamps confidence", async () => {
    const { parser, service } = setup();
    parser.result = ok([
      { category: " ", name: " Turon ", description: " ", priceCentavos: 2500, confidence: 1.4 },
      { category: "X", name: "", description: null, priceCentavos: 100, confidence: 0.5 },
      { category: "X", name: "Free", description: null, priceCentavos: 0, confidence: 0.5 },
    ]);
    const drafts = await service.readMenuPhoto(owner, STORE, photo);
    expect(drafts.ok && drafts.value).toEqual([
      { category: "Menu", name: "Turon", description: null, priceCentavos: 2500, confidence: 1 },
    ]);
  });

  it("only reads images under 5 MB, for the store's own team", async () => {
    const { parser, service } = setup();
    const text = await service.readMenuPhoto(owner, STORE, { ...photo, mimeType: "text/plain" });
    const huge = await service.readMenuPhoto(owner, STORE, {
      data: new Uint8Array(6 * 1024 * 1024),
      mimeType: "image/png",
    });
    const stranger = await service.readMenuPhoto(
      sessionUser("x", [{ role: "merchant_owner", merchantId: "merchant-b" }]),
      STORE,
      photo,
    );
    expect([text, huge, stranger].map((r) => !r.ok && r.error.code)).toEqual([
      "VALIDATION_FAILED",
      "VALIDATION_FAILED",
      "FORBIDDEN",
    ]);
    expect(parser.images).toEqual([]);
  });

  it("limits each store to 10 photos an hour", async () => {
    const { service } = setup();
    for (let i = 0; i < 10; i += 1) await service.readMenuPhoto(owner, STORE, photo);
    const eleventh = await service.readMenuPhoto(owner, STORE, photo);
    expect(!eleventh.ok && eleventh.error.code).toBe("RATE_LIMITED");
  });

  it("passes on a parser failure", async () => {
    const { parser, service } = setup();
    parser.result = err(new AppError("UNAVAILABLE", "Menu reading is not available right now."));
    const drafts = await service.readMenuPhoto(owner, STORE, photo);
    expect(!drafts.ok && drafts.error.code).toBe("UNAVAILABLE");
  });
});
