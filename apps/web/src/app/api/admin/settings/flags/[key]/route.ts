import { ValidationError } from "@klikgo/core";
import { FeatureFlagUpdateSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** PUT /api/admin/settings/flags/:key — switch a flag and save its settings (checked; admins). */
export async function PUT(
  request: Request,
  context: { params: Promise<{ key: string }> },
): Promise<Response> {
  return runRoute(request, async (meta) => {
    const { key } = await context.params;
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(key))
      return jsonError(new ValidationError("Unknown setting."), meta);
    const body = await parseBody(request, FeatureFlagUpdateSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().settingsAdmin.updateFlag(await getSessionUser(), key, body.value),
      meta,
    );
  });
}
