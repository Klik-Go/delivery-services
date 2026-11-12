import { RefundRequestSchema } from "@klikgo/types";
import { requireUser } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { parseIds, respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orders/:orderId/refunds — full (no amount) or partial refund of an online
 * payment, by an admin or the order's zone coordinator with TOTP; written to audit_logs.
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
    // Through the console service so the refund is written to the audit log.
    const refunded = await getContainer().adminOrders.refund(user.value, ids.value.orderId, {
      reason: body.value.reason,
      amountCentavos: body.value.amountCentavos,
    });
    return respond(refunded, meta, 201);
  });
}
