import { DeliveryLocationSchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { deliveryLocationCookie } from "@/server/customer/location";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { runRoute } from "@/server/http/route";

/** PUT /api/location — remember where to deliver (cookie) and say which zone serves it. */
export async function PUT(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, DeliveryLocationSchema);
    if (!body.ok) return jsonError(body.error, meta);
    const zone = await getContainer().serviceability.check(body.value.location);
    const response = jsonOk({ zone }, meta);
    const cookie = deliveryLocationCookie(body.value);
    response.headers.append(
      "set-cookie",
      `${cookie.name}=${encodeURIComponent(cookie.value)}; Path=/; Max-Age=${String(cookie.maxAge)}; HttpOnly; SameSite=Lax${cookie.secure ? "; Secure" : ""}`,
    );
    return response;
  });
}
