import type { AppRole, KycDocumentType, VehicleType } from "@klikgo/types";
import type {
  AuditEntry,
  FeatureFlagView,
  FeeRuleFields,
  FeeRuleView,
  IAuditLog,
  IKycStorage,
  IMerchantAdminRepository,
  IOpsOrderRepository,
  IRiderAdminRepository,
  IRiderOnboardingRepository,
  ISettingsRepository,
  IStaffRepository,
  IZoneAdminRepository,
  KycDocument,
  OpsMerchant,
  OpsOrder,
  OpsOrderDetail,
  OpsRider,
  RiderApplication,
  StaffGrant,
  SupportNote,
  ZonePatch,
  ZoneScope,
  ZoneView,
} from "../ops/ports";
import { checkOutline } from "../ops/zone-outline";
import { ServiceUnavailableError, type AppError } from "../shared/errors";
import type { Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";

const LIVE = ["placed", "accepted", "preparing", "ready", "picked_up"];
const within = (scope: ZoneScope, zoneId: string): boolean =>
  scope === "all" || scope.includes(zoneId);

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type FakeOpsOrder = Mutable<Omit<OpsOrderDetail, "notes">> & { notes: SupportNote[] };
export type FakeOpsRider = Mutable<OpsRider> & {
  vehicleType: VehicleType;
  plateNo: string | null;
  payoutAccountName: string | null;
  statusReason: string | null;
  ratingAvg: number;
  ratingCount: number;
  phone: string | null;
  appliedAt: Date;
};

/** The console's world in memory: orders, riders, documents, zones, stores, flags, staff, audit. */
export class OpsState {
  readonly orders: FakeOpsOrder[] = [];
  readonly riders: FakeOpsRider[] = [];
  readonly documents: KycDocument[] = [];
  readonly zones: ZoneView[] = [];
  readonly merchants: OpsMerchant[] = [];
  readonly flagsList: FeatureFlagView[] = [];
  readonly grants: StaffGrant[] = [];
  readonly audit: AuditEntry[] = [];
  readonly files = new Map<string, number>();
  readonly coordinatorZones = new Map<string, string[]>();
  /** Makes the next rider assignment lose a race (someone changed the order first). */
  raceOnAssign = false;
  private sequence = 0;

  constructor(readonly now: () => Date) {}

  nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${String(this.sequence)}`;
  }

  // --- seeding ------------------------------------------------------------------------------

  addOrder(order: Partial<FakeOpsOrder> & Pick<FakeOpsOrder, "id">): FakeOpsOrder {
    const row: FakeOpsOrder = {
      code: `KG-${order.id}`,
      status: "preparing",
      zoneId: "makati",
      merchantId: "kape",
      merchantName: "Kape't Tinapay",
      paymentMethod: "cod",
      totalCentavos: 17_900,
      riderId: null,
      riderName: null,
      prepMinutes: 15,
      placedAt: this.now(),
      acceptedAt: this.now(),
      readyAt: null,
      pickedUpAt: null,
      flaggedAt: null,
      dispatchFlaggedAt: null,
      store: { lat: 14.5583, lng: 121.0187 },
      dropoff: { lat: 14.5547, lng: 121.0244 },
      customerId: "customer-1",
      paymentStatus: "pending",
      cancelReason: null,
      rejectReason: null,
      history: [],
      notes: [],
      ...order,
    };
    this.orders.push(row);
    return row;
  }

  addRider(rider: Partial<FakeOpsRider> & Pick<FakeOpsRider, "id">): FakeOpsRider {
    const row: FakeOpsRider = {
      userId: `user-${rider.id}`,
      name: `${rider.id} Rider`,
      zoneId: "makati",
      status: "active",
      isOnline: true,
      activeOrderId: null,
      location: { lat: 14.559, lng: 121.022 },
      locationAt: this.now(),
      vehicleType: "motorcycle",
      plateNo: "NAB 1234",
      payoutAccountName: null,
      statusReason: null,
      ratingAvg: 4.8,
      ratingCount: 20,
      phone: "+639170000022",
      appliedAt: this.now(),
      ...rider,
    };
    this.riders.push(row);
    return row;
  }

  addDocument(doc: Partial<KycDocument> & Pick<KycDocument, "riderId" | "type">): KycDocument {
    const row: KycDocument = {
      id: this.nextId("doc"),
      storagePath: `${doc.riderId}/${doc.type}.jpg`,
      status: "pending",
      rejectionReason: null,
      uploadedAt: this.now(),
      ...doc,
    };
    this.documents.push(row);
    this.files.set(row.storagePath, 1);
    return row;
  }

  addZone(zone: Partial<ZoneView> & Pick<ZoneView, "id">): ZoneView {
    const row: ZoneView = {
      name: zone.id,
      slug: zone.id,
      baseFeeCentavos: 3900,
      perKmCentavos: 1000,
      maxRadiusKm: 5,
      isActive: true,
      coordinatorId: null,
      coordinatorName: null,
      ring: [
        [121, 14.5],
        [121.1, 14.5],
        [121.1, 14.6],
        [121, 14.6],
      ],
      feeRules: [],
      ...zone,
    };
    this.zones.push(row);
    return row;
  }

  /** A rider's application with the latest document of each type. */
  application(r: FakeOpsRider): RiderApplication {
    const latest = new Map<KycDocumentType, KycDocument>();
    for (const doc of this.documents.filter((d) => d.riderId === r.id)) latest.set(doc.type, doc);
    return {
      id: r.id,
      userId: r.userId,
      name: r.name,
      phone: r.phone,
      zoneId: r.zoneId,
      vehicleType: r.vehicleType,
      plateNo: r.plateNo,
      payoutAccountName: r.payoutAccountName,
      status: r.status,
      statusReason: r.statusReason,
      ratingAvg: r.ratingAvg,
      ratingCount: r.ratingCount,
      appliedAt: r.appliedAt,
      documents: [...latest.values()],
    };
  }
}

/** audit_logs in memory. */
export class MemoryAuditLog implements IAuditLog {
  constructor(private readonly s: OpsState) {}

  record(entry: AuditEntry): Promise<void> {
    this.s.audit.push(entry);
    return Promise.resolve();
  }
}

/** Live orders, rider (re)assignment and support notes. */
export class FakeOpsOrders implements IOpsOrderRepository {
  constructor(private readonly s: OpsState) {}

  board(scope: ZoneScope): Promise<OpsOrder[]> {
    return Promise.resolve(
      this.s.orders.filter((o) => LIVE.includes(o.status) && within(scope, o.zoneId)),
    );
  }

  order(orderId: string): Promise<OpsOrderDetail | null> {
    return Promise.resolve(this.s.orders.find((o) => o.id === orderId) ?? null);
  }

  rider(riderId: string): Promise<OpsRider | null> {
    return Promise.resolve(this.s.riders.find((r) => r.id === riderId) ?? null);
  }

  riders(scope: ZoneScope): Promise<OpsRider[]> {
    return Promise.resolve(this.s.riders.filter((r) => within(scope, r.zoneId)));
  }

  assignRider(input: {
    readonly orderId: string;
    readonly riderId: string;
    readonly expectedRiderId: string | null;
    readonly earningsCentavos: Centavos;
  }): Promise<boolean> {
    const order = this.s.orders.find((o) => o.id === input.orderId);
    if (this.s.raceOnAssign || !order || order.riderId !== input.expectedRiderId) {
      return Promise.resolve(false);
    }
    const previous = this.s.riders.find((r) => r.id === order.riderId);
    if (previous) previous.activeOrderId = null;
    const rider = this.s.riders.find((r) => r.id === input.riderId);
    order.riderId = input.riderId;
    order.riderName = rider?.name ?? null;
    if (rider) rider.activeOrderId = order.id;
    return Promise.resolve(true);
  }

  addNote(input: {
    readonly orderId: string;
    readonly authorId: string;
    readonly authorRole: AppRole;
    readonly body: string;
  }): Promise<string> {
    const id = this.s.nextId("note");
    this.s.orders
      .find((o) => o.id === input.orderId)
      ?.notes.push({
        id,
        body: input.body,
        authorRole: input.authorRole,
        authorName: input.authorId,
        at: this.s.now(),
      });
    return Promise.resolve(id);
  }
}

/** The KYC queue and rider status. */
export class FakeRiderAdmin implements IRiderAdminRepository {
  constructor(private readonly s: OpsState) {}

  riders(
    scope: ZoneScope,
    filter: "pending" | "active" | "suspended" | "coaching",
  ): Promise<RiderApplication[]> {
    const chosen = this.s.riders.filter(
      (r) =>
        within(scope, r.zoneId) &&
        (filter === "pending"
          ? r.status === "pending_kyc"
          : filter === "coaching"
            ? r.status === "active" && r.ratingCount >= 5 && r.ratingAvg < 3.5
            : r.status === filter),
    );
    return Promise.resolve(chosen.map((r) => this.s.application(r)));
  }

  rider(riderId: string): Promise<RiderApplication | null> {
    const r = this.s.riders.find((row) => row.id === riderId);
    return Promise.resolve(r ? this.s.application(r) : null);
  }

  document(documentId: string): Promise<(KycDocument & { readonly zoneId: string }) | null> {
    const doc = this.s.documents.find((d) => d.id === documentId);
    const rider = doc ? this.s.riders.find((r) => r.id === doc.riderId) : undefined;
    return Promise.resolve(doc && rider ? { ...doc, zoneId: rider.zoneId } : null);
  }

  reviewDocument(input: {
    readonly documentId: string;
    readonly status: "approved" | "rejected";
    readonly reason: string | null;
  }): Promise<boolean> {
    const index = this.s.documents.findIndex(
      (d) => d.id === input.documentId && d.status === "pending",
    );
    const doc = this.s.documents[index];
    if (!doc) return Promise.resolve(false);
    this.s.documents[index] = { ...doc, status: input.status, rejectionReason: input.reason };
    return Promise.resolve(true);
  }

  setStatus(
    riderId: string,
    status: "active" | "suspended",
    reason: string | null,
  ): Promise<boolean> {
    const rider = this.s.riders.find((r) => r.id === riderId);
    if (!rider || rider.status === status) return Promise.resolve(false);
    rider.status = status;
    rider.statusReason = reason;
    if (status !== "active") rider.isOnline = false;
    return Promise.resolve(true);
  }
}

/** Applying to ride and uploading documents. */
export class FakeRiderOnboarding implements IRiderOnboardingRepository {
  constructor(private readonly s: OpsState) {}

  apply(input: {
    readonly userId: string;
    readonly zoneId: string;
    readonly vehicleType: VehicleType;
    readonly plateNo: string | null;
    readonly fullName: string;
    readonly payoutAccountName: string;
  }): Promise<string | null> {
    if (this.s.riders.some((r) => r.userId === input.userId)) return Promise.resolve(null);
    const id = this.s.nextId("rider");
    this.s.addRider({
      id,
      userId: input.userId,
      name: input.fullName,
      zoneId: input.zoneId,
      status: "pending_kyc",
      isOnline: false,
      vehicleType: input.vehicleType,
      plateNo: input.plateNo,
      payoutAccountName: input.payoutAccountName,
      ratingAvg: 0,
      ratingCount: 0,
      location: null,
      locationAt: null,
    });
    return Promise.resolve(id);
  }

  riderForUser(userId: string): Promise<RiderApplication | null> {
    const r = this.s.riders.find((row) => row.userId === userId);
    return Promise.resolve(r ? this.s.application(r) : null);
  }

  addDocument(input: {
    readonly riderId: string;
    readonly type: KycDocumentType;
    readonly storagePath: string;
  }): Promise<string> {
    return Promise.resolve(this.s.addDocument(input).id);
  }

  zoneExists(zoneId: string): Promise<boolean> {
    return Promise.resolve(this.s.zones.some((z) => z.id === zoneId));
  }
}

/** The private rider-kyc bucket. */
export class FakeKycStorage implements IKycStorage {
  down = false;

  constructor(private readonly s: OpsState) {}

  signedUrl(path: string, seconds: number): Promise<Result<string, AppError>> {
    if (this.down) return Promise.resolve(err(new ServiceUnavailableError("Storage is down.")));
    return Promise.resolve(
      ok(`https://storage.test/sign/rider-kyc/${path}?expires=${String(seconds)}`),
    );
  }

  upload(path: string, file: { readonly bytes: Uint8Array }): Promise<Result<void, AppError>> {
    if (this.down) return Promise.resolve(err(new ServiceUnavailableError("Storage is down.")));
    this.s.files.set(path, file.bytes.byteLength);
    return Promise.resolve(ok(undefined));
  }
}

/** Zones, outlines, coordinators and fee rules. */
export class FakeZoneAdmin implements IZoneAdminRepository {
  constructor(private readonly s: OpsState) {}

  zones(scope: ZoneScope): Promise<ZoneView[]> {
    return Promise.resolve(this.s.zones.filter((z) => within(scope, z.id)));
  }

  zone(zoneId: string): Promise<ZoneView | null> {
    return Promise.resolve(this.s.zones.find((z) => z.id === zoneId) ?? null);
  }

  update(zoneId: string, patch: ZonePatch): Promise<boolean> {
    return Promise.resolve(
      this.patch(
        zoneId,
        Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
      ),
    );
  }

  setArea(
    zoneId: string,
    ring: readonly (readonly [number, number])[],
  ): Promise<"ok" | "invalid" | "missing"> {
    if (!this.s.zones.some((z) => z.id === zoneId)) return Promise.resolve("missing");
    if (!checkOutline(ring).ok) return Promise.resolve("invalid");
    this.patch(zoneId, { ring });
    return Promise.resolve("ok");
  }

  isZoneCoordinator(userId: string, zoneId: string): Promise<boolean> {
    return Promise.resolve(this.s.coordinatorZones.get(userId)?.includes(zoneId) ?? false);
  }

  setCoordinator(zoneId: string, userId: string | null): Promise<boolean> {
    return Promise.resolve(this.patch(zoneId, { coordinatorId: userId, coordinatorName: userId }));
  }

  feeRule(ruleId: string): Promise<FeeRuleView | null> {
    return Promise.resolve(
      this.s.zones.flatMap((z) => z.feeRules).find((r) => r.id === ruleId) ?? null,
    );
  }

  createFeeRule(zoneId: string, fields: FeeRuleFields): Promise<string> {
    const id = this.s.nextId("rule");
    const zone = this.s.zones.find((z) => z.id === zoneId);
    if (zone) this.patch(zoneId, { feeRules: [...zone.feeRules, { id, zoneId, ...fields }] });
    return Promise.resolve(id);
  }

  updateFeeRule(ruleId: string, patch: Partial<FeeRuleFields>): Promise<boolean> {
    let found = false;
    for (const zone of [...this.s.zones]) {
      const rules = zone.feeRules.map((rule) => {
        if (rule.id !== ruleId) return rule;
        found = true;
        return { ...rule, ...patch };
      });
      this.patch(zone.id, { feeRules: rules });
    }
    return Promise.resolve(found);
  }

  private patch(zoneId: string, fields: Partial<ZoneView>): boolean {
    const index = this.s.zones.findIndex((z) => z.id === zoneId);
    const zone = this.s.zones[index];
    if (!zone) return false;
    this.s.zones[index] = { ...zone, ...fields };
    return true;
  }
}

/** Store status and commission. */
export class FakeMerchantAdmin implements IMerchantAdminRepository {
  constructor(private readonly s: OpsState) {}

  merchants(scope: ZoneScope): Promise<OpsMerchant[]> {
    return Promise.resolve(this.s.merchants.filter((m) => within(scope, m.zoneId)));
  }

  merchant(merchantId: string): Promise<OpsMerchant | null> {
    return Promise.resolve(this.s.merchants.find((m) => m.id === merchantId) ?? null);
  }

  setStatus(
    merchantId: string,
    status: "active" | "suspended",
    reason: string | null,
  ): Promise<boolean> {
    return Promise.resolve(this.patch(merchantId, { status, statusReason: reason }));
  }

  setCommission(merchantId: string, bps: number, from: Date, now: Date): Promise<boolean> {
    return Promise.resolve(
      this.patch(
        merchantId,
        from <= now
          ? { commissionBps: bps, nextCommissionBps: null, nextCommissionFrom: null }
          : { nextCommissionBps: bps, nextCommissionFrom: from },
      ),
    );
  }

  private patch(merchantId: string, fields: Partial<OpsMerchant>): boolean {
    const index = this.s.merchants.findIndex((m) => m.id === merchantId);
    const store = this.s.merchants[index];
    if (!store) return false;
    this.s.merchants[index] = { ...store, ...fields };
    return true;
  }
}

/** Feature flags. */
export class FakeSettings implements ISettingsRepository {
  constructor(private readonly s: OpsState) {}

  flags(): Promise<FeatureFlagView[]> {
    return Promise.resolve([...this.s.flagsList]);
  }

  flag(key: string): Promise<FeatureFlagView | null> {
    return Promise.resolve(this.s.flagsList.find((f) => f.key === key) ?? null);
  }

  updateFlag(
    key: string,
    value: { readonly enabled: boolean; readonly rollout: Readonly<Record<string, unknown>> },
  ): Promise<boolean> {
    const index = this.s.flagsList.findIndex((f) => f.key === key);
    const flag = this.s.flagsList[index];
    if (!flag) return Promise.resolve(false);
    this.s.flagsList[index] = { ...flag, ...value, updatedAt: this.s.now() };
    return Promise.resolve(true);
  }
}

/** Staff role grants. */
export class FakeStaff implements IStaffRepository {
  constructor(private readonly s: OpsState) {}

  staff(): Promise<StaffGrant[]> {
    return Promise.resolve([...this.s.grants]);
  }

  grant(grantId: string): Promise<StaffGrant | null> {
    return Promise.resolve(this.s.grants.find((g) => g.id === grantId) ?? null);
  }

  revoke(grantId: string): Promise<boolean> {
    const index = this.s.grants.findIndex((g) => g.id === grantId);
    if (index < 0) return Promise.resolve(false);
    this.s.grants.splice(index, 1);
    return Promise.resolve(true);
  }
}
