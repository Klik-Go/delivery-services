import type { SessionUser } from "../auth/session-user";
import { NotFoundError, ValidationError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { ConsoleAccess } from "./console-access";
import type { FeeRuleFields, IZoneAdminRepository, ZonePatch, ZoneView } from "./ports";
import { checkOutline, type LngLat } from "./zone-outline";

const invalid = (path: string, message: string): ValidationError =>
  new ValidationError(message, [{ path, message }]);

/**
 * Zones and their fees (docs/BUSINESS.md §5.5, §9.2.4). Coordinators can look at their zones;
 * only admins change areas, fees, radius, status and coordinators. Placed orders keep the fees
 * they were charged (snapshots), so fee changes reach new quotes only.
 */
export class ZoneAdminService {
  constructor(private readonly deps: { access: ConsoleAccess; zones: IZoneAdminRepository }) {}

  async list(user: SessionUser | null): Promise<Result<ZoneView[], AppError>> {
    const allowed = this.deps.access.scope(user);
    if (!allowed.ok) return allowed;
    return ok(await this.deps.zones.zones(allowed.value.scope));
  }

  async update(
    user: SessionUser | null,
    zoneId: string,
    patch: ZonePatch,
  ): Promise<Result<ZoneView, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    if (!(await this.deps.zones.update(zoneId, patch)))
      return err(new NotFoundError("Zone", zoneId));
    await this.deps.access.record(
      admin.value,
      "zone.update",
      { type: "zones", id: zoneId },
      {
        fields: Object.keys(patch).join(","),
        ...(patch.baseFeeCentavos === undefined ? {} : { baseFeeCentavos: patch.baseFeeCentavos }),
        ...(patch.perKmCentavos === undefined ? {} : { perKmCentavos: patch.perKmCentavos }),
        ...(patch.isActive === undefined ? {} : { isActive: patch.isActive }),
      },
    );
    return this.reload(zoneId);
  }

  /** Redraws the zone; outlines that cross themselves are refused before and by PostGIS. */
  async setArea(
    user: SessionUser | null,
    zoneId: string,
    ring: readonly LngLat[],
  ): Promise<Result<ZoneView, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    const checked = checkOutline(ring);
    if (!checked.ok) return err(invalid("ring", checked.reason));
    const saved = await this.deps.zones.setArea(zoneId, checked.ring);
    if (saved === "missing") return err(new NotFoundError("Zone", zoneId));
    if (saved === "invalid")
      return err(invalid("ring", "That outline is not a valid area. Redraw it."));
    await this.deps.access.record(
      admin.value,
      "zone.update",
      { type: "zones", id: zoneId },
      {
        fields: "area",
        corners: checked.ring.length,
      },
    );
    return this.reload(zoneId);
  }

  /** Makes someone the zone's coordinator; they must be invited as its coordinator first. */
  async setCoordinator(
    user: SessionUser | null,
    zoneId: string,
    coordinatorId: string | null,
  ): Promise<Result<ZoneView, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    if (coordinatorId && !(await this.deps.zones.isZoneCoordinator(coordinatorId, zoneId))) {
      return err(invalid("userId", "Invite this person as the zone's coordinator first."));
    }
    if (!(await this.deps.zones.setCoordinator(zoneId, coordinatorId))) {
      return err(new NotFoundError("Zone", zoneId));
    }
    await this.deps.access.record(
      admin.value,
      "zone.coordinator",
      { type: "zones", id: zoneId },
      {
        coordinatorId,
      },
    );
    return this.reload(zoneId);
  }

  async createFeeRule(
    user: SessionUser | null,
    zoneId: string,
    fields: FeeRuleFields,
  ): Promise<Result<{ readonly id: string }, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    if (!(await this.deps.zones.zone(zoneId))) return err(new NotFoundError("Zone", zoneId));
    const id = await this.deps.zones.createFeeRule(zoneId, fields);
    await this.deps.access.record(
      admin.value,
      "fee_rule.create",
      { type: "fee_rules", id },
      {
        zoneId,
        kind: fields.kind,
        feeCentavos: fields.feeCentavos,
      },
    );
    return ok({ id });
  }

  async updateFeeRule(
    user: SessionUser | null,
    ruleId: string,
    patch: Partial<FeeRuleFields>,
  ): Promise<Result<{ readonly id: string }, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    const before = await this.deps.zones.feeRule(ruleId);
    if (!before) return err(new NotFoundError("Fee rule", ruleId));
    const minD = patch.minDistanceM === undefined ? before.minDistanceM : patch.minDistanceM;
    const maxD = patch.maxDistanceM === undefined ? before.maxDistanceM : patch.maxDistanceM;
    if (minD !== null && maxD !== null && maxD <= minD) {
      return err(invalid("maxDistanceM", "The band must end after it starts."));
    }
    await this.deps.zones.updateFeeRule(ruleId, patch);
    await this.deps.access.record(
      admin.value,
      "fee_rule.update",
      { type: "fee_rules", id: ruleId },
      {
        zoneId: before.zoneId,
        fields: Object.keys(patch).join(","),
        feeBefore: before.feeCentavos,
        feeAfter: patch.feeCentavos ?? before.feeCentavos,
      },
    );
    return ok({ id: ruleId });
  }

  private async reload(zoneId: string): Promise<Result<ZoneView, AppError>> {
    const zone = await this.deps.zones.zone(zoneId);
    return zone ? ok(zone) : err(new NotFoundError("Zone", zoneId));
  }
}
