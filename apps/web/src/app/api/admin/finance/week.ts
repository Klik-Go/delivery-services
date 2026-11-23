import { ValidationError } from "@klikgo/core";
import { WeekStartSchema } from "@klikgo/types";

/** The ?week=YYYY-MM-DD query (a Monday; services check the day). */
export function weekParam(
  request: Request,
): { ok: true; week: string } | { ok: false; error: ValidationError } {
  const parsed = WeekStartSchema.safeParse({
    week: new URL(request.url).searchParams.get("week") ?? "",
  });
  return parsed.success
    ? { ok: true, week: parsed.data.week }
    : {
        ok: false,
        error: new ValidationError("Pick a week (its Monday).", [
          { path: "week", message: "Missing" },
        ]),
      };
}
