import assert from "node:assert/strict";
import { test } from "node:test";
import { KeywordClassifier } from "../src/dispatch/classifier";
import { findDuplicateCandidates } from "../src/dispatch/duplicates";
import { checkEligibility, isOnShift } from "../src/dispatch/eligibility";
import { estimateTravelMinutes, haversineMiles } from "../src/dispatch/geo";
import { computePriorityScore } from "../src/dispatch/priority";
import { rankCrews } from "../src/dispatch/scoring";
import { Assignment, Crew, Incident } from "../src/dispatch/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-08-19T14:00:00-04:00"); // 2pm, inside day shift

function makeCrew(overrides: Partial<Crew>): Crew {
  return {
    crewId: "CRW-X", crewName: "Crew X", capability: "TREE_REMOVAL",
    latitude: 40.6602, longitude: -73.969, borough: "Brooklyn",
    status: "AVAILABLE", currentWorkload: 0, maxWorkload: 4,
    shiftStart: "06:00", shiftEnd: "22:00",
    ...overrides,
  };
}

function makeIncident(overrides: Partial<Incident>): Incident {
  return {
    incidentId: "INC-T1", description: "test", incidentType: "FALLEN_TREE",
    severity: "CRITICAL", status: "OPEN",
    latitude: 40.6776, longitude: -73.9722,
    address: "Flatbush Ave & 7th Ave", borough: "Brooklyn",
    requiredCapability: "TREE_REMOVAL",
    reportedAt: new Date(NOW.getTime() - 4 * 60_000),
    estimatedDurationMinutes: 90, roadObstruction: true, safetyRisk: true,
    priorityScore: 92,
    ...overrides,
  };
}

// The demo cast: Alpha should win the Flatbush tree; Delta is closest but
// wrong capability; Echo is qualified but off shift.
const alpha = makeCrew({ crewId: "CRW-A", crewName: "Crew Alpha" });
const delta = makeCrew({
  crewId: "CRW-D", crewName: "Crew Delta", capability: "GENERAL_MAINTENANCE",
  latitude: 40.682, longitude: -73.974,
});
const echo = makeCrew({
  crewId: "CRW-E", crewName: "Crew Echo", status: "OFF_SHIFT",
  latitude: 40.8501, longitude: -73.8662, borough: "Bronx",
  shiftStart: "22:00", shiftEnd: "06:00",
});

// ---------------------------------------------------------------------------
// Geo
// ---------------------------------------------------------------------------

test("haversine: Flatbush tree to Prospect Park yard is about 1.2 miles", () => {
  const miles = haversineMiles(40.6776, -73.9722, 40.6602, -73.969);
  assert.ok(miles > 1.0 && miles < 1.5, `got ${miles}`);
});

test("ETA includes mobilization overhead", () => {
  assert.equal(estimateTravelMinutes(0), 5);
  assert.equal(estimateTravelMinutes(12), 65); // 12mi at 12mph = 60min + 5
});

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

test("critical + obstruction + safety scores in the 90s", () => {
  const score = computePriorityScore({
    severity: "CRITICAL", roadObstruction: true, safetyRisk: true,
    reportedAt: new Date(NOW.getTime() - 4 * 60_000), now: NOW,
  });
  assert.equal(score, 92); // 70 + 12 + 10 + 0.4 aging
});

test("aging bonus is capped so old low work cannot outrank new critical work", () => {
  const oldLow = computePriorityScore({
    severity: "LOW", roadObstruction: false, safetyRisk: false,
    reportedAt: new Date(NOW.getTime() - 48 * 3600_000), now: NOW,
  });
  assert.equal(oldLow, 23); // 15 + capped 8
});

test("priority never exceeds 100", () => {
  const score = computePriorityScore({
    severity: "CRITICAL", roadObstruction: true, safetyRisk: true,
    reportedAt: new Date(NOW.getTime() - 10 * 3600_000), now: NOW,
  });
  assert.equal(score, 100);
});

// ---------------------------------------------------------------------------
// Shift logic
// ---------------------------------------------------------------------------

test("day shift crew is on shift at 2pm", () => {
  assert.equal(isOnShift(alpha, NOW), true);
});

test("overnight shift wraps midnight correctly", () => {
  const night = makeCrew({ shiftStart: "22:00", shiftEnd: "06:00" });
  assert.equal(isOnShift(night, new Date("2026-08-19T23:30:00-04:00")), true);
  assert.equal(isOnShift(night, new Date("2026-08-19T03:00:00-04:00")), true);
  assert.equal(isOnShift(night, new Date("2026-08-19T14:00:00-04:00")), false);
});

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

test("wrong capability is ineligible with a clear reason", () => {
  const result = checkEligibility(delta, makeIncident({}), [], NOW);
  assert.equal(result.eligible, false);
  assert.match(result.reasons[0], /TREE_REMOVAL/);
});

test("off-shift crew is ineligible", () => {
  const result = checkEligibility(echo, makeIncident({}), [], NOW);
  assert.equal(result.eligible, false);
  assert.match(result.reasons.join(" "), /Off shift/);
});

test("full queue is ineligible", () => {
  const busy = makeCrew({ currentWorkload: 4 });
  const result = checkEligibility(busy, makeIncident({}), [], NOW);
  assert.equal(result.eligible, false);
  assert.match(result.reasons.join(" "), /Queue full/);
});

test("crew on-site at a critical incident cannot be pulled for equal severity", () => {
  const crew = makeCrew({ status: "ON_JOB", currentWorkload: 1 });
  const criticalJob = makeIncident({ incidentId: "INC-C", severity: "CRITICAL" });
  const work = [{
    assignment: {
      assignmentId: "ASG-1", incidentId: "INC-C", crewId: crew.crewId,
      assignedAt: NOW, status: "ON_SITE",
    } as Assignment,
    incident: criticalJob,
  }];
  const result = checkEligibility(crew, makeIncident({ severity: "CRITICAL" }), work, NOW);
  assert.equal(result.eligible, false);
  assert.match(result.reasons.join(" "), /cannot be interrupted/);
});

// ---------------------------------------------------------------------------
// Ranking — the demo narratives must hold
// ---------------------------------------------------------------------------

test("Flatbush tree: Alpha recommended; Delta and Echo ineligible", () => {
  const incident = makeIncident({});
  const incidentsById = new Map([[incident.incidentId, incident]]);
  const { recommendations, ineligible } = rankCrews(
    incident, [alpha, delta, echo], [], incidentsById, NOW
  );

  assert.equal(recommendations[0].crew.crewId, "CRW-A");
  const ineligibleIds = ineligible.map((i) => i.crew.crewId).sort();
  assert.deepEqual(ineligibleIds, ["CRW-D", "CRW-E"]);
});

test("Atlantic Ave pothole: available Golf outranks overloaded Bravo", () => {
  const pothole = makeIncident({
    incidentId: "INC-P", incidentType: "POTHOLE", severity: "HIGH",
    requiredCapability: "ROAD_REPAIR",
    latitude: 40.6863, longitude: -73.9846,
    roadObstruction: true, safetyRisk: true,
  });
  const bravo = makeCrew({
    crewId: "CRW-B", crewName: "Crew Bravo", capability: "ROAD_REPAIR",
    latitude: 40.742, longitude: -73.976, borough: "Manhattan",
    status: "ON_JOB", currentWorkload: 3,
  });
  const golf = makeCrew({
    crewId: "CRW-G", crewName: "Crew Golf", capability: "ROAD_REPAIR",
    latitude: 40.678, longitude: -73.944, borough: "Brooklyn",
  });
  const bravoJob = makeIncident({
    incidentId: "INC-1014", incidentType: "POTHOLE", severity: "HIGH",
    requiredCapability: "ROAD_REPAIR", status: "IN_PROGRESS",
  });
  const assignments: Assignment[] = [{
    assignmentId: "ASG-9001", incidentId: "INC-1014", crewId: "CRW-B",
    assignedAt: NOW, status: "ON_SITE",
  }];
  const incidentsById = new Map([
    [pothole.incidentId, pothole], [bravoJob.incidentId, bravoJob],
  ]);

  const { recommendations } = rankCrews(pothole, [bravo, golf], assignments, incidentsById, NOW);
  assert.equal(recommendations[0].crew.crewId, "CRW-G");
  assert.equal(recommendations[1].crew.crewId, "CRW-B");
  assert.ok(
    recommendations[0].score.total - recommendations[1].score.total >= 20,
    "Golf should win decisively, not on a tiebreak"
  );
});

test("every recommendation carries explainable factors", () => {
  const incident = makeIncident({});
  const incidentsById = new Map([[incident.incidentId, incident]]);
  const { recommendations } = rankCrews(incident, [alpha], [], incidentsById, NOW);
  const { score } = recommendations[0];
  assert.ok(score.factors.length >= 4);
  assert.equal(
    score.total <= 100 && score.total >= 0, true,
    `score out of bounds: ${score.total}`
  );
});

// ---------------------------------------------------------------------------
// Duplicate candidate detection
// ---------------------------------------------------------------------------

test("same type, 60m apart, minutes apart -> duplicate candidate", () => {
  const existing = makeIncident({ incidentId: "INC-1001" });
  const candidates = findDuplicateCandidates(
    {
      incidentType: "FALLEN_TREE", latitude: 40.6779, longitude: -73.9718,
      reportedAt: new Date(NOW.getTime() + 10 * 60_000),
    },
    [existing]
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].incident.incidentId, "INC-1001");
});

test("different type or far away or long ago -> no candidate", () => {
  const existing = makeIncident({ incidentId: "INC-1001" });
  const base = { latitude: 40.6779, longitude: -73.9718, reportedAt: NOW };

  assert.equal(findDuplicateCandidates(
    { ...base, incidentType: "POTHOLE" }, [existing]).length, 0);
  assert.equal(findDuplicateCandidates(
    { ...base, incidentType: "FALLEN_TREE", latitude: 40.75 }, [existing]).length, 0);
  assert.equal(findDuplicateCandidates(
    { ...base, incidentType: "FALLEN_TREE",
      reportedAt: new Date(NOW.getTime() + 5 * 3600_000) }, [existing]).length, 0);
});

test("resolved incidents cannot acquire duplicates", () => {
  const resolved = makeIncident({ incidentId: "INC-R", status: "RESOLVED" });
  const candidates = findDuplicateCandidates(
    { incidentType: "FALLEN_TREE", latitude: 40.6776, longitude: -73.9722, reportedAt: NOW },
    [resolved]
  );
  assert.equal(candidates.length, 0);
});

// ---------------------------------------------------------------------------
// Mock classifier (sanity only — replaced by AIP Logic in Foundry)
// ---------------------------------------------------------------------------

test("classifier extracts type, capability, and flags from the demo report", () => {
  const c = new KeywordClassifier().classify(
    "Huge tree came down on Flatbush Ave near the intersection. " +
    "It's blocking one lane and cars are swerving around it."
  );
  assert.equal(c.incidentType, "FALLEN_TREE");
  assert.equal(c.requiredCapability, "TREE_REMOVAL");
  assert.equal(c.roadObstruction, true);
  assert.equal(c.safetyRisk, true);
  assert.equal(c.severity, "CRITICAL");
});
