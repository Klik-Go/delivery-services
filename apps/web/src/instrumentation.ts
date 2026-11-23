/**
 * Next.js instrumentation: errors thrown while rendering pages or in route handlers that nothing
 * caught go to the error tracker, scrubbed of personal data by the core ErrorReportingService.
 * Node.js only (CLAUDE.md: never Edge).
 */
export async function onRequestError(
  error: unknown,
  request: {
    readonly path: string;
    readonly headers: Record<string, string | string[] | undefined>;
  },
  context: { readonly routePath?: string; readonly routeType?: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getContainer } = await import("./server/container");
  const requestId = request.headers["x-request-id"];
  await getContainer().errors.reportServer(error, {
    ...(typeof requestId === "string" ? { requestId } : {}),
    route: context.routePath ?? request.path.split("?")[0] ?? "/",
    ...(context.routeType ? { tags: { route_type: context.routeType } } : {}),
  });
}
