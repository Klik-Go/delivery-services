import type { StoreSettingsInput } from "@klikgo/types";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthorizationService } from "../auth/authorization-service";
import { InMemoryStoreRepository, sessionUser } from "../testing";
import { StoreSettingsService } from "./store-settings-service";

const STORE = "merchant-a";
const owner = sessionUser("owner-a", [{ role: "merchant_owner", merchantId: STORE }]);
const staff = sessionUser("staff-a", [{ role: "merchant_staff", merchantId: STORE }]);
const otherOwner = sessionUser("owner-b", [{ role: "merchant_owner", merchantId: "merchant-b" }]);

const settings = (overrides: Partial<StoreSettingsInput> = {}): StoreSettingsInput => ({
  hours: {
    mon: [{ open: "10:00", close: "14:00" }],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  },
  defaultPrepMinutes: 20,
  acceptsCod: false,
  serviceRadiusKm: 3,
  ...overrides,
});

describe("StoreSettingsService", () => {
  let stores: InMemoryStoreRepository;
  let service: StoreSettingsService;

  beforeEach(() => {
    stores = new InMemoryStoreRepository();
    stores.add(STORE);
    service = new StoreSettingsService({ stores, authz: new AuthorizationService() });
  });

  it("lets the owner save hours, prep time, cash on delivery and radius", async () => {
    const saved = await service.update(owner, STORE, settings());
    expect(saved).toMatchObject({
      ok: true,
      value: { defaultPrepMinutes: 20, acceptsCod: false, serviceRadiusKm: 3 },
    });
  });

  it("refuses a radius beyond the zone's maximum", async () => {
    const saved = await service.update(owner, STORE, settings({ serviceRadiusKm: 9 }));
    expect(!saved.ok && saved.error.message).toBe("Your zone delivers up to 5 km.");
  });

  it("lets staff open the store but not change its settings", async () => {
    const opened = await service.setOpen(staff, STORE, true);
    const changed = await service.update(staff, STORE, settings());
    expect(opened.ok && opened.value.isOpen).toBe(true);
    expect(!changed.ok && changed.error.code).toBe("FORBIDDEN");
  });

  it("keeps a store that is not approved yet closed", async () => {
    stores.add(STORE, { status: "pending" });
    const opened = await service.setOpen(owner, STORE, true);
    const closed = await service.setOpen(owner, STORE, false);
    expect(!opened.ok && opened.error.code).toBe("CONFLICT");
    expect(closed.ok).toBe(true);
  });

  it("never shows or changes another store", async () => {
    expect((await service.settings(otherOwner, STORE)).ok).toBe(false);
    expect((await service.setOpen(otherOwner, STORE, true)).ok).toBe(false);
    expect((await service.addClosure(otherOwner, STORE, { closedOn: "2026-12-25" })).ok).toBe(
      false,
    );
  });

  it("adds one closure per date and removes it again", async () => {
    const added = await service.addClosure(owner, STORE, {
      closedOn: "2026-12-25",
      reason: "Pasko",
    });
    const duplicate = await service.addClosure(owner, STORE, { closedOn: "2026-12-25" });
    expect(added.ok).toBe(true);
    expect(!duplicate.ok && duplicate.error.code).toBe("CONFLICT");
    if (!added.ok) return;

    const removed = await service.removeClosure(owner, STORE, added.value.id);
    const again = await service.removeClosure(owner, STORE, added.value.id);
    expect(removed.ok).toBe(true);
    expect(!again.ok && again.error.code).toBe("NOT_FOUND");
  });

  it("reports a store that does not exist", async () => {
    const admin = sessionUser("admin", [{ role: "admin" }]);
    expect((await service.settings(admin, "missing")).ok).toBe(false);
    expect((await service.update(admin, "missing", settings())).ok).toBe(false);
    expect((await service.setOpen(admin, "missing", true)).ok).toBe(false);
  });
});
