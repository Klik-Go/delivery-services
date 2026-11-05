import { MerchantApplicationSchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { clientIp } from "@/server/http/client-ip";
import { parseBody } from "@/server/http/parse-body";
import { runRoute } from "@/server/http/route";

/** POST /api/partners/applications — the public "Become a partner" form (rate-limited per network). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, MerchantApplicationSchema);
    if (!body.ok) return jsonError(body.error, meta);
    const service = getContainer().merchantOnboarding();
    if (!service.ok) return jsonError(service.error, meta, getContainer().logger);
    const receipt = await service.value.apply(body.value, { clientIp: clientIp(request.headers) });
    if (!receipt.ok) return jsonError(receipt.error, meta);
    const message = receipt.value.inArea
      ? "Thank you! Our team will contact you within 2 working days."
      : "We're not in your area yet. We'll contact you as soon as Klik Go opens there.";
    return jsonOk({ ...receipt.value, message }, meta, 201);
  });
}
