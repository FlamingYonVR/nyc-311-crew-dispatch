import { checkEligibility, CrewActiveWork, getActiveWork } from "./eligibility";
import { estimateTravelMinutes, haversineMiles } from "./geo";
import { Assignment, Crew, Incident, SEVERITY_RANK } from "./types";

/**
 * Deterministic crew ranking.
 *
 * Every eligible crew gets a 0-100 score from four weighted components.
 * Each component also emits a human-readable factor string, so the UI (and
 * the AIP-generated operator explanation) can show exactly why a crew won.
 */

export const WEIGHTS = {
  proximity: 40,
  availability: 25,
  workload: 20,
  severityFit: 15,
} as const; // sums to 100

/** ETA at or beyond this many minutes earns zero proximity points. */
export const MAX_USEFUL_ETA_MINUTES = 45;

/** Fraction of availability points a crew keeps while already on a job. */
export const ON_JOB_AVAILABILITY_FACTOR = 0.3;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export interface ScoreBreakdown {
  proximity: number;
  availability: number;
  workload: number;
  severityFit: number;
  total: number;
  distanceMiles: number;
  etaMinutes: number;
  factors: string[];
}

export function scoreCrew(
  crew: Crew,
  incident: Incident,
  activeWork: CrewActiveWork[]
): ScoreBreakdown {
  const factors: string[] = [];

  // 1. Proximity: linear decay from full points at ETA 0 to zero at 45 min.
  const distanceMiles = haversineMiles(
    crew.latitude, crew.longitude, incident.latitude, incident.longitude
  );
  const etaMinutes = estimateTravelMinutes(distanceMiles);
  const proximity = WEIGHTS.proximity * clamp01(1 - etaMinutes / MAX_USEFUL_ETA_MINUTES);
  factors.push(`${distanceMiles.toFixed(1)} mi away — estimated arrival ~${etaMinutes} min`);

  // 2. Availability: full points if free now, a fraction if already on a job.
  let availability: number;
  if (crew.status === "AVAILABLE") {
    availability = WEIGHTS.availability;
    factors.push("Available now");
  } else {
    availability = WEIGHTS.availability * ON_JOB_AVAILABILITY_FACTOR;
    factors.push("Currently on a job — new work would queue behind it");
  }

  // 3. Workload: more open jobs, fewer points.
  const workload =
    WEIGHTS.workload * (1 - clamp01(crew.currentWorkload / crew.maxWorkload));
  factors.push(
    crew.currentWorkload === 0
      ? "No open workload"
      : `Carrying ${crew.currentWorkload} open job${crew.currentWorkload > 1 ? "s" : ""}`
  );

  // 4. Severity fit: penalize pulling a crew off equal-or-higher-severity work.
  let severityFit = WEIGHTS.severityFit;
  const maxActiveSeverity = Math.max(
    0, ...activeWork.map((w) => SEVERITY_RANK[w.incident.severity])
  );
  if (maxActiveSeverity === 0) {
    factors.push("Not committed to other incidents");
  } else if (maxActiveSeverity < SEVERITY_RANK[incident.severity]) {
    severityFit = WEIGHTS.severityFit * 0.6;
    factors.push("Current work is lower severity and can wait");
  } else {
    severityFit = WEIGHTS.severityFit * 0.25;
    factors.push("Already committed to work of equal or higher severity");
  }

  const total = Math.round(proximity + availability + workload + severityFit);
  return {
    proximity: Math.round(proximity),
    availability: Math.round(availability),
    workload: Math.round(workload),
    severityFit: Math.round(severityFit),
    total,
    distanceMiles: Number(distanceMiles.toFixed(2)),
    etaMinutes,
    factors,
  };
}

export interface CrewRecommendation {
  crew: Crew;
  score: ScoreBreakdown;
}

export interface IneligibleCrew {
  crew: Crew;
  reasons: string[];
}

export interface RankingResult {
  /** Eligible crews, best first. recommendations[0] is the recommendation. */
  recommendations: CrewRecommendation[];
  ineligible: IneligibleCrew[];
}

export function rankCrews(
  incident: Incident,
  crews: Crew[],
  assignments: Assignment[],
  incidentsById: Map<string, Incident>,
  now: Date
): RankingResult {
  const recommendations: CrewRecommendation[] = [];
  const ineligible: IneligibleCrew[] = [];

  for (const crew of crews) {
    const activeWork = getActiveWork(crew, assignments, incidentsById);
    const eligibility = checkEligibility(crew, incident, activeWork, now);
    if (!eligibility.eligible) {
      ineligible.push({ crew, reasons: eligibility.reasons });
      continue;
    }
    recommendations.push({ crew, score: scoreCrew(crew, incident, activeWork) });
  }

  // Deterministic order: score desc, then ETA asc, then id for stable ties.
  recommendations.sort(
    (a, b) =>
      b.score.total - a.score.total ||
      a.score.etaMinutes - b.score.etaMinutes ||
      a.crew.crewId.localeCompare(b.crew.crewId)
  );
  return { recommendations, ineligible };
}
