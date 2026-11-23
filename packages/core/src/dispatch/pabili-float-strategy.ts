import type { DispatchJob, IDispatchStrategy, RiderCandidate } from "./ports";

/**
 * Pabili jobs go only to riders whose float covers the customer's budget, because the rider pays
 * for the items before the customer repays them at the door (Phase 13). Store orders pass straight
 * through. Wraps another strategy, which still picks among the riders left (OCP).
 */
export class PabiliFloatStrategy implements IDispatchStrategy {
  constructor(private readonly inner: IDispatchStrategy) {}

  choose(job: DispatchJob, candidates: readonly RiderCandidate[]): RiderCandidate | null {
    if (job.kind !== "pabili") return this.inner.choose(job, candidates);
    return this.inner.choose(
      job,
      candidates.filter((rider) => rider.pabiliFloatCentavos >= job.budgetCentavos),
    );
  }
}
