import {
  err,
  ok,
  pesosToCentavos,
  ServiceUnavailableError,
  ValidationError,
  type AppError,
  type IMenuParser,
  type Logger,
  type MenuImage,
  type ParsedMenuItem,
  type Result,
} from "@klikgo/core";
import { z } from "zod";

/** Only the menu photo and this fixed instruction are sent: never customer data. */
const PROMPT = `You read photos of printed Filipino restaurant menus (karinderya, carinderia, cafe).
List every dish or drink you can read. For each one give:
- category: the menu section it is under (e.g. "Ulam", "Silog Meals", "Drinks"); use "Menu" if there is none
- name: as printed
- description: short text printed with it, or an empty string
- price: the price in Philippine pesos as digits only, e.g. "120" or "85.50"; if several sizes, use the smallest
- confidence: 0 to 1, how sure you are that name and price are read correctly
Skip anything without a readable price. Do not invent items.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          category: { type: "STRING" },
          name: { type: "STRING" },
          description: { type: "STRING" },
          price: { type: "STRING" },
          confidence: { type: "NUMBER" },
        },
        required: ["category", "name", "price", "confidence"],
      },
    },
  },
  required: ["items"],
} as const;

const ParsedMenuSchema = z.object({
  items: z.array(
    z.object({
      category: z.string().max(60).catch("Menu"),
      name: z.string().max(120),
      description: z.string().max(500).optional(),
      price: z.string().max(20),
      confidence: z.number().catch(0.5),
    }),
  ),
});

const GenerateContentSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }).optional(),
      }),
    )
    .optional(),
});

/** Turns "₱1,299.50" or "P120" into centavos, or null when it is not a price. */
function priceToCentavos(price: string): number | null {
  const cleaned = price.replace(/[₱pP\s]/g, "").replace(/\.$/, "");
  try {
    return pesosToCentavos(cleaned);
  } catch {
    return null;
  }
}

/**
 * Reads menu photos with the Gemini API (structured JSON output, validated with zod). The model
 * comes from GEMINI_MODEL. Free-tier data may be used by Google to improve its products, so only
 * the merchant's own menu photo is ever sent (docs/BUILD_PLAN.md §2 "AI").
 */
export class GeminiMenuParser implements IMenuParser {
  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      logger: Logger;
      fetch?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  async parse(image: MenuImage): Promise<Result<ParsedMenuItem[], AppError>> {
    const send = this.options.fetch ?? fetch;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.options.model)}:generateContent`;
    let response: Response;
    try {
      response = await send(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.options.apiKey },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  inline_data: {
                    mime_type: image.mimeType,
                    data: Buffer.from(image.data).toString("base64"),
                  },
                },
                { text: PROMPT },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 45_000),
      });
    } catch (error) {
      this.options.logger.error("menu_parser.request_failed", { err: error });
      return err(unavailable());
    }
    if (!response.ok) {
      // Never log the response body: it may echo the request.
      this.options.logger.error("menu_parser.http_error", { status: response.status });
      return err(response.status === 429 ? busy() : unavailable());
    }

    const envelope = GenerateContentSchema.safeParse(await response.json());
    const text = envelope.success
      ? envelope.data.candidates?.[0]?.content?.parts.map((part) => part.text ?? "").join("")
      : undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(text ?? "");
    } catch {
      this.options.logger.warn("menu_parser.unreadable_reply", {});
      return err(new ValidationError("We couldn't read a menu in that photo. Try a clearer one."));
    }
    const parsed = ParsedMenuSchema.safeParse(raw);
    if (!parsed.success)
      return err(new ValidationError("We couldn't read a menu in that photo. Try a clearer one."));

    const items: ParsedMenuItem[] = [];
    for (const item of parsed.data.items) {
      const priceCentavos = priceToCentavos(item.price);
      if (priceCentavos === null) continue;
      items.push({
        category: item.category,
        name: item.name,
        description: item.description || null,
        priceCentavos,
        confidence: item.confidence,
      });
    }
    return ok(items);
  }
}

function unavailable(): ServiceUnavailableError {
  return new ServiceUnavailableError(
    "Menu reading is not available right now. Please try again in a few minutes.",
  );
}

function busy(): ServiceUnavailableError {
  return new ServiceUnavailableError("Menu reading is busy right now. Please try again shortly.");
}
