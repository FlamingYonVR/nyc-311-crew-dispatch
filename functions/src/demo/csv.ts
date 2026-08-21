import * as fs from "fs";
import {
  Assignment,
  AssignmentStatus,
  Capability,
  Crew,
  CrewStatus,
  Incident,
  IncidentStatus,
  IncidentType,
  Severity,
} from "../dispatch/types";

/**
 * Minimal CSV loading for the LOCAL demo runner only.
 * In Foundry the data lives in datasets backing Ontology objects; nothing in
 * src/dispatch/ knows CSVs exist.
 */

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((f) => f !== "")) rows.push(row); }

  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const bool = (s: string) => s === "true";

export function loadIncidents(path: string): Incident[] {
  return parseCsv(fs.readFileSync(path, "utf8")).map((r) => ({
    incidentId: r.incident_id,
    description: r.description,
    incidentType: r.incident_type as IncidentType,
    severity: r.severity as Severity,
    status: r.status as IncidentStatus,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    address: r.address,
    borough: r.borough,
    requiredCapability: r.required_capability as Capability,
    reportedAt: new Date(r.reported_at),
    estimatedDurationMinutes: Number(r.estimated_duration_minutes),
    roadObstruction: bool(r.road_obstruction),
    safetyRisk: bool(r.safety_risk),
    priorityScore: Number(r.priority_score),
    duplicateOf: r.duplicate_of || undefined,
    assignedCrewId: r.assigned_crew_id || undefined,
  }));
}

export function loadCrews(path: string): Crew[] {
  return parseCsv(fs.readFileSync(path, "utf8")).map((r) => ({
    crewId: r.crew_id,
    crewName: r.crew_name,
    capability: r.capability as Capability,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    borough: r.borough,
    status: r.status as CrewStatus,
    currentWorkload: Number(r.current_workload),
    maxWorkload: Number(r.max_workload),
    shiftStart: r.shift_start,
    shiftEnd: r.shift_end,
  }));
}

export function loadAssignments(path: string): Assignment[] {
  return parseCsv(fs.readFileSync(path, "utf8")).map((r) => ({
    assignmentId: r.assignment_id,
    incidentId: r.incident_id,
    crewId: r.crew_id,
    assignedAt: new Date(r.assigned_at),
    estimatedArrival: r.estimated_arrival ? new Date(r.estimated_arrival) : undefined,
    status: r.status as AssignmentStatus,
  }));
}

export interface RawRequest {
  requestId: string;
  receivedAt: Date;
  channel: string;
  latitude: number;
  longitude: number;
  borough: string;
  description: string;
}

export function loadRequests(path: string): RawRequest[] {
  return parseCsv(fs.readFileSync(path, "utf8")).map((r) => ({
    requestId: r.request_id,
    receivedAt: new Date(r.received_at),
    channel: r.channel,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    borough: r.borough,
    description: r.description,
  }));
}
