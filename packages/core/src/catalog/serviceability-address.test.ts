import { describe, expect, it } from "vitest";
import { AuthorizationService } from "../auth/authorization-service";
import { InMemoryRateLimiter } from "../testing/auth-fakes";
import { InMemoryAddressRepository, InMemoryWaitlistRepository } from "../testing/catalog-fakes";
import { MemoryLogger } from "../testing/memory-logger";
import { sessionUser } from "../testing/session-users";
import { AddressService } from "./address-service";
import { ServiceabilityService } from "./serviceability-service";
import { AYALA, catalogWorld } from "../testing/catalog-world";

const PASIG = { lat: 14.5731, lng: 121.0614 + 0.05 };

describe("ServiceabilityService", () => {
  function setup() {
    const { area } = catalogWorld();
    const waitlist = new InMemoryWaitlistRepository();
    const service = new ServiceabilityService({
      serviceArea: area,
      waitlist,
      rateLimiter: new InMemoryRateLimiter(),
      logger: new MemoryLogger(),
    });
    return { service, waitlist };
  }

  it("names the zone that serves a pin, or none", async () => {
    const { service } = setup();
    expect((await service.check(AYALA))?.name).toBe("Makati City");
    expect(await service.check(PASIG)).toBeNull();
  });

  it("records waitlist sign-ups with a normalised phone, five per network per hour", async () => {
    const { service, waitlist } = setup();
    const input = {
      name: "Ana",
      phone: "0917 123 4567",
      email: "Ana@Example.test",
      barangay: "Kapitolyo",
      location: PASIG,
    };
    for (let i = 0; i < 5; i += 1)
      expect((await service.joinWaitlist(input, { clientIp: "1.2.3.4" })).ok).toBe(true);
    const sixth = await service.joinWaitlist(input, { clientIp: "1.2.3.4" });
    expect(!sixth.ok && sixth.error.code).toBe("RATE_LIMITED");
    expect(waitlist.entries[0]).toMatchObject({
      phone: "+639171234567",
      email: "ana@example.test",
      city: null,
    });
    const bad = await service.joinWaitlist({ ...input, phone: "123" }, { clientIp: "5.6.7.8" });
    expect(!bad.ok && bad.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("AddressService", () => {
  function setup() {
    const { area } = catalogWorld();
    const addresses = new InMemoryAddressRepository();
    return {
      addresses,
      service: new AddressService({
        addresses,
        serviceArea: area,
        authz: new AuthorizationService(),
      }),
    };
  }
  const customer = sessionUser("c-1", [{ role: "customer" }], "aal1");
  const input = {
    label: "Home",
    location: AYALA,
    landmark: "Beside the 7-Eleven",
    barangay: "San Lorenzo",
    city: "Makati City",
    contactPhone: "0917 000 0103",
    isDefault: true,
  };

  it("saves an address as the new default and says which zone serves it", async () => {
    const { service, addresses } = setup();
    await service.save(customer, { ...input, label: "Office" });
    const saved = await service.save(customer, input);
    expect(saved.ok && saved.value.zone?.slug).toBe("makati");
    const list = await service.list(customer);
    expect(list.ok && list.value.map((a) => [a.label, a.isDefault, a.contactPhone])).toEqual([
      ["Office", false, "+639170000103"],
      ["Home", true, "+639170000103"],
    ]);
    expect(addresses.rows).toHaveLength(2);
  });

  it("needs a signed-in customer and a mobile contact number", async () => {
    const { service } = setup();
    expect(!(await service.save(null, input)).ok).toBe(true);
    expect(!(await service.list(null)).ok).toBe(true);
    const bad = await service.save(customer, { ...input, contactPhone: "02 8888 0000" });
    expect(!bad.ok && bad.error.code).toBe("VALIDATION_FAILED");
  });
});
