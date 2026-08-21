import { haversineMiles } from "./geo";
import { Incident, IncidentType } from "./types";

/**
 * Duplicate detection, stage 1 of 2 (deterministic).
 *
 * Code narrows the field with hard facts — same incident type, physically
 * close, reported around the same time. Only the surviving candidates are
 * sent to AIP (aip/detect_duplicate.md) to judge whether the two *texts*
 * plausibly describe the same real-world event. This keeps the LLM from ever
 * comparing an incident in Queens to one in Staten Island.
 */

export const DUPLICATE_MAX_DISTANCE_MILES = 0.25;
export const DUPLICATE_MAX_AGE_MINUTES = 180;

export interface DuplicateCandidate {
  incident: Incident;
  distanceMiles: number;
  minutesApart: number;
}

export interface NewReport {
  incidentType: IncidentType;
  latitude: number;
  longitude: number;
  reportedAt: Date;
}

export function findDuplicateCandidates(
  report: NewReport,
  existingIncidents: Incident[]
): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];

  for (const incident of existingIncidents) {
    // Resolved/duplicate incidents can't acquire new duplicates.
    if (incident.status === "RESOLVED" || incident.status === "DUPLICATE") continue;
    if (incident.incidentType !== report.incidentType) continue;

    const minutesApart =
      Math.abs(report.reportedAt.getTime() - incident.reportedAt.getTime()) / 60_000;
    if (minutesApart > DUPLICATE_MAX_AGE_MINUTES) continue;

    const distanceMiles = haversineMiles(
      report.latitude, report.longitude, incident.latitude, incident.longitude
    );
    if (distanceMiles > DUPLICATE_MAX_DISTANCE_MILES) continue;

    candidates.push({
      incident,
      distanceMiles: Number(distanceMiles.toFixed(3)),
      minutesApart: Math.round(minutesApart),
    });
  }

  // Closest first.
  return candidates.sort((a, b) => a.distanceMiles - b.distanceMiles);
}
