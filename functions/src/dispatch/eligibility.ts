import {
  ACTIVE_ASSIGNMENT_STATUSES,
  Assignment,
  Crew,
  Incident,
  SEVERITY_RANK,
} from "./types";

/**
 * Hard eligibility constraints — deterministic by design.
 *
 * The LLM never decides whether a crew is on shift, has the right skill, or
 * is locked on a critical job. These are facts enforced in code; the AI only
 * interprets ambiguous text and explains decisions afterwards.
 */

export interface CrewActiveWork {
  assignment: Assignment;
  incident: Incident;
}

export interface EligibilityResult {
  eligible: boolean;
  /** Human-readable reasons a crew was excluded (shown in the UI). */
  reasons: string[];
}

/** Is `now` within the crew's shift? Handles overnight shifts (e.g. 22:00-06:00). */
export function isOnShift(crew: Crew, now: Date): boolean {
  const minutesOfDay = now.getHours() * 60 + now.getMinutes();
  const parse = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const start = parse(crew.shiftStart);
  const end = parse(crew.shiftEnd);
  if (start <= end) {
    return minutesOfDay >= start && minutesOfDay < end;
  }
  // Overnight shift wraps midnight: on shift if after start OR before end.
  return minutesOfDay >= start || minutesOfDay < end;
}

/** The crew's not-yet-completed assignments, joined to their incidents. */
export function getActiveWork(
  crew: Crew,
  assignments: Assignment[],
  incidentsById: Map<string, Incident>
): CrewActiveWork[] {
  return assignments
    .filter(
      (a) => a.crewId === crew.crewId && ACTIVE_ASSIGNMENT_STATUSES.includes(a.status)
    )
    .flatMap((assignment) => {
      const incident = incidentsById.get(assignment.incidentId);
      return incident ? [{ assignment, incident }] : [];
    });
}

export function checkEligibility(
  crew: Crew,
  incident: Incident,
  activeWork: CrewActiveWork[],
  now: Date
): EligibilityResult {
  const reasons: string[] = [];

  if (crew.capability !== incident.requiredCapability) {
    reasons.push(
      `Lacks required capability ${incident.requiredCapability} (has ${crew.capability})`
    );
  }

  if (crew.status === "OFF_SHIFT" || !isOnShift(crew, now)) {
    reasons.push(`Off shift (works ${crew.shiftStart}-${crew.shiftEnd})`);
  }

  if (crew.currentWorkload >= crew.maxWorkload) {
    reasons.push(`Queue full (${crew.currentWorkload}/${crew.maxWorkload} jobs)`);
  }

  // A crew actively working a CRITICAL incident cannot be interrupted or
  // queued onto — that would delay the city's most important work.
  const lockedOn = activeWork.find(
    (w) =>
      w.incident.severity === "CRITICAL" &&
      SEVERITY_RANK[w.incident.severity] >= SEVERITY_RANK[incident.severity] &&
      (w.assignment.status === "EN_ROUTE" || w.assignment.status === "ON_SITE")
  );
  if (lockedOn) {
    reasons.push(
      `Committed to critical incident ${lockedOn.incident.incidentId} and cannot be interrupted`
    );
  }

  return { eligible: reasons.length === 0, reasons };
}
