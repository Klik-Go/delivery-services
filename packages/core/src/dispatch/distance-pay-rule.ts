import { roadMeters } from "../catalog/geo";
import type { Centavos } from "../shared/money";
import type { DispatchJob, DispatchSettings, IRiderPayRule } from "./ports";

/**
 * Rider pay per job: a base amount plus a per-kilometre rate past the free kilometres, by road
 * distance from the store to the drop-off (docs/OPEN_QUESTIONS.md Q29). Tips are paid on top.
 */
export class DistancePayRule implements IRiderPayRule {
  payFor(job: DispatchJob, settings: DispatchSettings): Centavos {
    const km = roadMeters(job.pickup, job.dropoff) / 1000;
    const extraKm = Math.ceil(Math.max(0, km - settings.riderFreeKm));
    return settings.riderBaseCentavos + extraKm * settings.riderPerKmCentavos;
  }
}
