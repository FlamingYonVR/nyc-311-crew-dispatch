import * as path from "path";
import { KeywordClassifier } from "../dispatch/classifier";
import { findDuplicateCandidates } from "../dispatch/duplicates";
import { computePriorityScore } from "../dispatch/priority";
import { rankCrews } from "../dispatch/scoring";
import { Incident } from "../dispatch/types";
import { loadAssignments, loadCrews, loadIncidents, loadRequests, RawRequest } from "./csv";

/**
 * Local end-to-end runner for the vertical slice:
 *   raw request -> classification -> priority -> eligibility -> ranking
 *   -> recommendation -> simulated Assign action (printed ontology edits)
 *
 * Usage: node dist/src/demo/demo.js [1|2|3]   (scenario number, default 1)
 *
 * In Foundry, the same flow is: Action "Submit Service Request" -> AIP Logic
 * classification -> TypeScript function recommendCrews() -> Workshop UI ->
 * Action "Assign Crew" applying the ontology edits printed here.
 */

// Compiled location is functions/dist/src/demo/, so data/ is four levels up.
const DATA_DIR = path.resolve(__dirname, "../../../../data");
const SCENARIO_FILES: Record<string, string> = {
  "1": "scenario1_new_request.csv",
  "2": "scenario2_storm_requests.csv",
  "3": "scenario3_duplicate_request.csv",
};

const line = (c = "─") => console.log(c.repeat(72));

function printQueue(incidents: Incident[], title: string, highlight: Set<string>) {
  console.log(`\n${title}`);
  line();
  const open = incidents
    .filter((i) => i.status === "OPEN")
    .sort((a, b) => b.priorityScore - a.priorityScore);
  for (const inc of open.slice(0, 10)) {
    const marker = highlight.has(inc.incidentId) ? " ◄ NEW" : "";
    console.log(
      `  ${String(inc.priorityScore).padStart(3)}  ${inc.severity.padEnd(8)} ` +
      `${inc.incidentType.padEnd(16)} ${inc.address}, ${inc.borough}${marker}`
    );
  }
}

function main() {
  const scenario = process.argv[2] ?? "1";
  const file = SCENARIO_FILES[scenario];
  if (!file) {
    console.error(`Unknown scenario "${scenario}". Use 1, 2, or 3.`);
    process.exit(1);
  }

  const now = new Date();
  const incidents = loadIncidents(path.join(DATA_DIR, "incidents.csv"));
  const crews = loadCrews(path.join(DATA_DIR, "crews.csv"));
  const assignments = loadAssignments(path.join(DATA_DIR, "assignments.csv"));
  const requests = loadRequests(path.join(DATA_DIR, file));
  const incidentsById = new Map(incidents.map((i) => [i.incidentId, i]));
  const classifier = new KeywordClassifier();

  console.log(`\nNYC 311 CREW DISPATCH — local vertical slice (scenario ${scenario})`);
  console.log(`State: ${incidents.filter((i) => i.status === "OPEN").length} open incidents, ` +
    `${crews.filter((c) => c.status === "AVAILABLE").length}/${crews.length} crews available`);

  const newIncidentIds = new Set<string>();

  for (const req of requests) {
    line("═");
    console.log(`INCOMING ${req.requestId} (${req.channel}) — ${req.borough}`);
    console.log(`  "${req.description}"`);

    // ── Step 1: classification (AIP Logic in Foundry; keyword mock locally)
    const c = classifier.classify(req.description);
    console.log(`\n  AIP classification:`);
    console.log(`    type=${c.incidentType}  severity=${c.severity}  capability=${c.requiredCapability}`);
    console.log(`    roadObstruction=${c.roadObstruction}  safetyRisk=${c.safetyRisk}  ` +
      `estDuration=${c.estimatedDurationMinutes}min`);

    // ── Step 2: deterministic priority from the extracted facts
    const priorityScore = computePriorityScore({
      severity: c.severity,
      roadObstruction: c.roadObstruction,
      safetyRisk: c.safetyRisk,
      reportedAt: req.receivedAt,
      now,
    });
    console.log(`    priorityScore=${priorityScore}/100 (deterministic)`);

    // ── Step 3: duplicate candidate check (deterministic pre-filter)
    const dupes = findDuplicateCandidates(
      { incidentType: c.incidentType, latitude: req.latitude,
        longitude: req.longitude, reportedAt: req.receivedAt },
      incidents
    );
    if (dupes.length > 0) {
      const d = dupes[0];
      console.log(`\n  ⚠ POSSIBLE DUPLICATE of ${d.incident.incidentId} ` +
        `(${d.distanceMiles} mi apart, reported ${d.minutesApart} min apart)`);
      console.log(`    -> in Foundry, AIP compares both descriptions and the dispatcher`);
      console.log(`       confirms via the "Mark Duplicate" action. Skipping dispatch.`);
      continue;
    }

    // Promote the request to an Incident (in Foundry: Action creates the object)
    const incident: Incident = {
      incidentId: req.requestId.replace("REQ", "INC"),
      description: req.description,
      incidentType: c.incidentType,
      severity: c.severity,
      status: "OPEN",
      latitude: req.latitude,
      longitude: req.longitude,
      address: "(reported location)",
      borough: req.borough,
      requiredCapability: c.requiredCapability,
      reportedAt: req.receivedAt,
      estimatedDurationMinutes: c.estimatedDurationMinutes,
      roadObstruction: c.roadObstruction,
      safetyRisk: c.safetyRisk,
      priorityScore,
    };
    incidents.push(incident);
    incidentsById.set(incident.incidentId, incident);
    newIncidentIds.add(incident.incidentId);

    // ── Step 4: deterministic eligibility + ranking
    const ranking = rankCrews(incident, crews, assignments, incidentsById, now);

    console.log(`\n  Ineligible crews:`);
    for (const { crew, reasons } of ranking.ineligible) {
      console.log(`    ✗ ${crew.crewName} (${crew.capability}): ${reasons.join("; ")}`);
    }

    console.log(`\n  Ranked eligible crews:`);
    for (const [i, rec] of ranking.recommendations.entries()) {
      const s = rec.score;
      console.log(`    ${i === 0 ? "► RECOMMENDED" : `  #${i + 1}`.padEnd(13)} ` +
        `${rec.crew.crewName} — ${s.total}/100 ` +
        `(proximity ${s.proximity}/40, availability ${s.availability}/25, ` +
        `workload ${s.workload}/20, severityFit ${s.severityFit}/15)`);
      if (i === 0) for (const f of s.factors) console.log(`        • ${f}`);
    }

    // ── Step 5: simulated "Assign Crew" action (ontology edits)
    const top = ranking.recommendations[0];
    if (top) {
      const eta = new Date(now.getTime() + top.score.etaMinutes * 60_000);
      console.log(`\n  "Assign Crew" would apply these ontology edits:`);
      console.log(`    CREATE Assignment { incident=${incident.incidentId}, crew=${top.crew.crewId}, ` +
        `eta=${eta.toLocaleTimeString()}, status=EN_ROUTE }`);
      console.log(`    UPDATE Incident ${incident.incidentId} { status=ASSIGNED, assignedCrewId=${top.crew.crewId} }`);
      console.log(`    UPDATE Crew ${top.crew.crewId} { status=ON_JOB, ` +
        `currentWorkload=${top.crew.currentWorkload + 1} }`);
    } else {
      console.log(`\n  No eligible crew — incident stays OPEN at top of queue.`);
    }
  }

  printQueue(incidents, "OPERATIONAL QUEUE (by deterministic priority)", newIncidentIds);
  console.log();
}

main();
