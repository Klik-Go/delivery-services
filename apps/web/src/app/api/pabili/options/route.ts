import { getContainer } from "@/server/container";
import { jsonOk } from "@/server/http/api-response";
import { runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/pabili/options — whether Pabili is on, the item cap, the fee and the list length. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => jsonOk(await getContainer().pabili.options(), meta));
}
