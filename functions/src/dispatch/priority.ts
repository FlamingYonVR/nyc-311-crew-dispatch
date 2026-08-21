import { Severity } from "./types";

/**
 * Deterministic incident priority (0-100).
 *
 * AIP extracts the *facts* (severity, obstruction, safety risk) from the
 * citizen's free text; this function turns those facts into the number the
 * queue is ordered by. Keeping the arithmetic out of the LLM means the queue
 * order is reproducible and auditable.
 *
 * MUST stay in sync with priority_score() in data/generate_data.py.
 */

export const SEVERITY_BASE: Record<Severity, number> = {
  CRITICAL: 70,
  HIGH: 50,
  MEDIUM: 32,
  LOW: 15,
};

export const ROAD_OBSTRUCTION_BONUS = 12;
export const SAFETY_RISK_BONUS = 10;
/** Points per minute open, capped, so old low-priority work isn't starved forever. */
export const AGING_POINTS_PER_MINUTE = 0.1;
export const AGING_CAP = 8;

export interface PriorityInput {
  severity: Severity;
  roadObstruction: boolean;
  safetyRisk: boolean;
  reportedAt: Date;
  now: Date;
}

export function computePriorityScore(input: PriorityInput): number {
  let score = SEVERITY_BASE[input.severity];
  if (input.roadObstruction) score += ROAD_OBSTRUCTION_BONUS;
  if (input.safetyRisk) score += SAFETY_RISK_BONUS;

  const minutesOpen = Math.max(0, (input.now.getTime() - input.reportedAt.getTime()) / 60_000);
  score += Math.min(AGING_CAP, minutesOpen * AGING_POINTS_PER_MINUTE);

  return Math.round(Math.min(score, 100));
}
