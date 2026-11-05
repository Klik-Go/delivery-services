import { MemoryLogger } from "@klikgo/core/testing";
import { describe, expect, it, vi } from "vitest";
import { GeminiMenuParser } from "./gemini-menu-parser";

const image = { data: new Uint8Array([137, 80, 78, 71]), mimeType: "image/png" };

function reply(items: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items }) }] } }] }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function parserWith(fetchImpl: typeof fetch, logger = new MemoryLogger()) {
  return new GeminiMenuParser({
    apiKey: "test-key",
    model: "gemini-test",
    logger,
    fetch: fetchImpl,
  });
}

describe("GeminiMenuParser", () => {
  it("sends only the menu photo and fixed instructions, asking for structured JSON", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(reply([]));
    await parserWith(send).parse(image);

    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("x-goog-api-key")).toBe("test-key");
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
      contents: { parts: { inline_data?: { mime_type: string; data: string }; text?: string }[] }[];
      generationConfig: { responseMimeType: string };
    };
    expect(body.contents[0]?.parts[0]?.inline_data).toEqual({
      mime_type: "image/png",
      data: "iVBORw==",
    });
    expect(body.contents[0]?.parts).toHaveLength(2);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("converts printed peso prices to centavos and skips unreadable ones", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(
      reply([
        { category: "Ulam", name: "Adobo", description: "", price: "₱1,120.50", confidence: 0.9 },
        { category: "Drinks", name: "Gulaman", price: "P25.", confidence: 0.7 },
        { category: "Ulam", name: "Market price fish", price: "SQ", confidence: 0.4 },
      ]),
    );
    const result = await parserWith(send).parse(image);
    expect(result).toEqual({
      ok: true,
      value: [
        {
          category: "Ulam",
          name: "Adobo",
          description: null,
          priceCentavos: 112050,
          confidence: 0.9,
        },
        {
          category: "Drinks",
          name: "Gulaman",
          description: null,
          priceCentavos: 2500,
          confidence: 0.7,
        },
      ],
    });
  });

  it("reports the service as unavailable on errors and as busy when rate-limited", async () => {
    const down = await parserWith(
      vi.fn<typeof fetch>().mockResolvedValue(new Response("x", { status: 500 })),
    ).parse(image);
    const busy = await parserWith(
      vi.fn<typeof fetch>().mockResolvedValue(new Response("x", { status: 429 })),
    ).parse(image);
    const offline = await parserWith(
      vi.fn<typeof fetch>().mockRejectedValue(new Error("ECONNRESET")),
    ).parse(image);
    expect([down, busy, offline].map((r) => !r.ok && r.error.code)).toEqual([
      "UNAVAILABLE",
      "UNAVAILABLE",
      "UNAVAILABLE",
    ]);
    expect(!busy.ok && busy.error.message).toMatch(/busy/);
  });

  it("asks for a clearer photo when the reply is not a menu", async () => {
    const garbage = new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }),
      { status: 200 },
    );
    const wrongShape = new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"dishes":[]}' }] } }] }),
      { status: 200 },
    );
    const first = await parserWith(vi.fn<typeof fetch>().mockResolvedValue(garbage)).parse(image);
    const second = await parserWith(vi.fn<typeof fetch>().mockResolvedValue(wrongShape)).parse(
      image,
    );
    expect(!first.ok && first.error.code).toBe("VALIDATION_FAILED");
    expect(!second.ok && second.error.code).toBe("VALIDATION_FAILED");
  });
});
