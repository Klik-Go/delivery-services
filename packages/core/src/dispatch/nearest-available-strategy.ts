import type { DispatchJob, IDispatchStrategy, RiderCandidate } from "./ports";

/**
 * Offers the job to the nearest free rider (docs/BUSINESS.md §5.3). For cash on delivery the rider
 * must be able to carry the order's cash without going over their limit.
 */
export class NearestAvailableStrategy implements IDispatchStrategy {
  choose(job: DispatchJob, candidates: readonly RiderCandidate[]): RiderCandidate | null {
    const eligible = candidates.filter(
      (rider) =>
        job.paymentMethod !== "cod" ||
        rider.cashHeldCentavos + job.totalCentavos <= rider.cashLimitCentavos,
    );
    return [...eligible].sort((a, b) => a.distanceM - b.distanceM)[0] ?? null;
  }
}
