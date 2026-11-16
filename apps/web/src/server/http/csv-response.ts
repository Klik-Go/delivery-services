import "server-only";
import type { AppError, CsvFile, Result } from "@klikgo/core";
import type { ApiMeta } from "@klikgo/types";
import { getContainer } from "../container";
import { jsonError } from "./api-response";

/** A CSV download (UTF-8 with BOM, opens in Google Sheets), or the JSON error envelope. */
export function csvResponse(result: Result<CsvFile, AppError>, meta: ApiMeta): Response {
  if (!result.ok) return jsonError(result.error, meta, getContainer().logger);
  const safeName = result.value.filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(result.value.body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safeName}"`,
      "cache-control": "no-store",
      "x-request-id": meta.requestId,
    },
  });
}
