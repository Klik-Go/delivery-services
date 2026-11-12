import { FLAG_ROLLOUT_SCHEMAS } from "@klikgo/types";
import type { SessionUser } from "../auth/session-user";
import { NotFoundError, ValidationError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { ConsoleAccess } from "./console-access";
import type { FeatureFlagView, ISettingsRepository } from "./ports";

/**
 * Feature flags and their settings (dispatch timings, store deadlines…), for admins. Flags with a
 * known shape are checked before saving, so a typo cannot stop dispatch or cancel orders early.
 */
export class SettingsService {
  constructor(private readonly deps: { access: ConsoleAccess; settings: ISettingsRepository }) {}

  async flags(user: SessionUser | null): Promise<Result<FeatureFlagView[], AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    return ok(await this.deps.settings.flags());
  }

  async updateFlag(
    user: SessionUser | null,
    key: string,
    value: { readonly enabled: boolean; readonly rollout: Readonly<Record<string, unknown>> },
  ): Promise<Result<FeatureFlagView, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    const current = await this.deps.settings.flag(key);
    if (!current) return err(new NotFoundError("Setting", key));
    const schema = FLAG_ROLLOUT_SCHEMAS[key];
    if (schema) {
      const parsed = schema.safeParse(value.rollout);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => ({
          path: ["rollout", ...issue.path.map(String)].join("."),
          message: issue.message,
        }));
        return err(new ValidationError(issues[0]?.message ?? "Check the values.", issues));
      }
    }
    await this.deps.settings.updateFlag(key, value, admin.value.id);
    await this.deps.access.record(
      admin.value,
      "feature_flag.update",
      { type: "feature_flags", id: null },
      {
        key,
        enabled: value.enabled,
      },
    );
    const updated = await this.deps.settings.flag(key);
    return updated ? ok(updated) : err(new NotFoundError("Setting", key));
  }
}
