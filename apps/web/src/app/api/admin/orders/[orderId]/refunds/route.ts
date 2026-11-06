import { RefundRequestSchema } from "@klikgo/types";
import { requireUser } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { parseIds, respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orders/:orderId/refunds — full (no amount) or partial refund of an online
 * payment. RefundService checks the order's zone: admins, or that zone's coordinator, with TOTP.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  return runRoute(request, async (meta) => {
    const user = await requireUser();
    if (!user.ok) return jsonError(user.error, meta);
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    const body = await parseBody(request, RefundRequestSchema);
    if (!body.ok) return jsonError(body.error, meta);
    const refunded = await getContainer().refunds.refund(
      {
        orderId: ids.value.orderId,
        reason: body.value.reason,
        ...(body.value.amountCentavos === undefined
          ? {}
          : { amountCentavos: body.value.amountCentavos }),
      },
      user.value,
    );
    return respond(refunded, meta, 201);
  });
}
