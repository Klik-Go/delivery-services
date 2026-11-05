import { MerchantApplicationStatusSchema } from "@klikgo/types";
import { requireAction } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/admin/merchant-applications?status=pending — admins (all zones) and coordinators (theirs). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const user = await requireAction({ type: "merchant.applications.view" });
    if (!user.ok) return jsonError(user.error, meta);
    const status = MerchantApplicationStatusSchema.catch("pending").parse(
      new URL(request.url).searchParams.get("status") ?? "pending",
    );
    const service = getContainer().merchantOnboarding();
    if (!service.ok) return jsonError(service.error, meta, getContainer().logger);
    return respond(await service.value.listApplications(user.value, status), meta);
  });
}
