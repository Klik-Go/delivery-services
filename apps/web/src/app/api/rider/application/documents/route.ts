import { ValidationError } from "@klikgo/core";
import { KycUploadSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** POST /api/rider/application/documents — multipart `type` + `file` (photo or PDF, 10 MB at most). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError(new ValidationError("Send the document as a form."), meta);
    }
    const file = form.get("file");
    const parsed = KycUploadSchema.safeParse({
      type: form.get("type"),
      file: file instanceof File ? { type: file.type, size: file.size } : undefined,
    });
    if (!parsed.success || !(file instanceof File)) {
      const message = parsed.success
        ? "Choose a file."
        : (parsed.error.issues[0]?.message ?? "Invalid document.");
      return jsonError(new ValidationError(message, [{ path: "file", message }]), meta);
    }
    return respond(
      await getContainer().riderOnboarding.upload(await getSessionUser(), parsed.data.type, {
        bytes: new Uint8Array(await file.arrayBuffer()),
        contentType: parsed.data.file.type,
      }),
      meta,
      201,
    );
  });
}
