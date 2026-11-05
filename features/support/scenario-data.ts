import type { LatLng } from "@klikgo/db/testing";

/** A merchant created in a scenario. */
export interface ScenarioMerchant {
  readonly id: string;
  readonly ownerId: string;
  readonly location: LatLng;
}

/**
 * Remembers what @db steps created, by the business names used in the Gherkin
 * ("Carmen", "Aling Nena's", "Rico"), so later steps can refer to them.
 */
export class ScenarioData {
  pilotZone: { id: string; centre: LatLng } | undefined;
  readonly people = new Map<string, string>();
  readonly merchants = new Map<string, ScenarioMerchant>();
  readonly riders = new Map<string, { id: string; userId: string }>();
  /** Order label ("Carmen from Aling Nena's") → order id. */
  readonly orders = new Map<string, string>();
  currentOrder: string | undefined;
  servingZone: string | null | undefined;
  offeredRiders: string[] = [];
  visible: string[] = [];
  lastError: string | null | undefined;

  /** The pilot zone, failing clearly if the Background step was skipped. */
  zone(): { id: string; centre: LatLng } {
    if (!this.pilotZone) throw new Error('Add "Given the pilot zone from the seed data" first.');
    return this.pilotZone;
  }

  /** Looks up a named entry, failing with the known names. */
  get<T>(map: Map<string, T>, name: string): T {
    const value = map.get(name);
    if (value === undefined)
      throw new Error(`Unknown "${name}". Known: ${[...map.keys()].join(", ")}`);
    return value;
  }
}
