/**
 * Core domain types for NYC 311 Crew Dispatch.
 *
 * Deliberately plain TypeScript with no Foundry imports: the same logic runs
 * in local tests and, behind a thin adapter, inside a Foundry Functions
 * repository where these interfaces map 1:1 onto Ontology object types.
 */

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const SEVERITY_RANK: Record<Severity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export type IncidentType =
  | "POTHOLE"
  | "FALLEN_TREE"
  | "STREETLIGHT_OUT"
  | "TRAFFIC_SIGNAL"
  | "GRAFFITI"
  | "FLOODING"
  | "SIDEWALK_HAZARD"
  | "ROAD_OBSTRUCTION"
  | "DAMAGED_SIGN";

export type Capability =
  | "TREE_REMOVAL"
  | "ROAD_REPAIR"
  | "ELECTRICAL"
  | "DRAINAGE"
  | "GENERAL_MAINTENANCE"
  | "SIGNAGE";

/** Which capability handles each incident type. Single source of truth. */
export const CAPABILITY_FOR_TYPE: Record<IncidentType, Capability> = {
  POTHOLE: "ROAD_REPAIR",
  FALLEN_TREE: "TREE_REMOVAL",
  STREETLIGHT_OUT: "ELECTRICAL",
  TRAFFIC_SIGNAL: "ELECTRICAL",
  GRAFFITI: "GENERAL_MAINTENANCE",
  FLOODING: "DRAINAGE",
  SIDEWALK_HAZARD: "ROAD_REPAIR",
  ROAD_OBSTRUCTION: "GENERAL_MAINTENANCE",
  DAMAGED_SIGN: "SIGNAGE",
};

export type IncidentStatus = "OPEN" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "DUPLICATE";
export type CrewStatus = "AVAILABLE" | "ON_JOB" | "OFF_SHIFT";
export type AssignmentStatus = "QUEUED" | "EN_ROUTE" | "ON_SITE" | "COMPLETED" | "CANCELLED";

export const ACTIVE_ASSIGNMENT_STATUSES: AssignmentStatus[] = ["QUEUED", "EN_ROUTE", "ON_SITE"];

export interface Incident {
  incidentId: string;
  description: string;
  incidentType: IncidentType;
  severity: Severity;
  status: IncidentStatus;
  latitude: number;
  longitude: number;
  address: string;
  borough: string;
  requiredCapability: Capability;
  reportedAt: Date;
  estimatedDurationMinutes: number;
  roadObstruction: boolean;
  safetyRisk: boolean;
  priorityScore: number;
  duplicateOf?: string;
  assignedCrewId?: string;
}

export interface Crew {
  crewId: string;
  crewName: string;
  capability: Capability;
  latitude: number;
  longitude: number;
  borough: string;
  status: CrewStatus;
  currentWorkload: number;
  maxWorkload: number;
  /** Shift boundaries as local "HH:MM"; overnight shifts (start > end) supported. */
  shiftStart: string;
  shiftEnd: string;
}

export interface Assignment {
  assignmentId: string;
  incidentId: string;
  crewId: string;
  assignedAt: Date;
  estimatedArrival?: Date;
  status: AssignmentStatus;
}

/**
 * Structured output of incident classification.
 * In Foundry this shape is produced by an AIP Logic function
 * (see aip/classify_incident.md); locally a keyword mock implements it.
 */
export interface Classification {
  incidentType: IncidentType;
  severity: Severity;
  requiredCapability: Capability;
  roadObstruction: boolean;
  safetyRisk: boolean;
  estimatedDurationMinutes: number;
  summary: string;
  reasoning: string;
}
