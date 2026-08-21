# Foundry Build Guide — NYC 311 Crew Dispatch

Ordered steps to stand the app up in a Foundry + AIP instance (e.g. the
build.palantir.com developer tier). Names of buttons/menus drift between
Foundry versions — the *concepts* below are stable; verify exact labels in
your instance rather than trusting this doc blindly.

Build order matters: each phase depends on the previous one.

```
CSVs → Datasets → (Pipeline Builder typing) → Ontology objects + links
     → Actions → TypeScript Functions → AIP Logic → Workshop
```

---

## Phase 1 — Project + datasets (~15 min)

1. Create a Project (e.g. `NYC 311 Crew Dispatch`) with folders: `data/`,
   `logic/`, `app/`.
2. Regenerate fresh CSVs locally (`python3 data/generate_data.py`) so
   timestamps are recent, then upload each CSV as a new dataset:
   `incidents`, `crews`, `assignments`, `capabilities`.
3. Typing: uploaded CSVs often land as all-string schemas. Use Pipeline
   Builder (one pipeline, four outputs) to cast columns:
   - timestamps: `reported_at`, `resolved_at`, `assigned_at`, `estimated_arrival`
   - doubles: `latitude`, `longitude`
   - integers: `estimated_duration_minutes`, `priority_score`,
     `current_workload`, `max_workload`, `typical_crew_size`
   - booleans: `road_obstruction`, `safety_risk`
   Output typed datasets (e.g. `incidents_clean`) — these back the ontology.
   Pipeline Builder is also the honest answer to "where would real 311 data
   land?" in the demo.

## Phase 2 — Ontology (~30 min)

In Ontology Manager, create three object types backed by the typed datasets.

**Incident** (backing: `incidents_clean`)
- Primary key: `incident_id`. Title property: `summary`-like — use
  `incident_type` + `address` or just `incident_id`.
- Properties: description, incidentType, severity, status, latitude, longitude
  (if your instance supports a geopoint/geohash property type, add one derived
  from lat/lon — Workshop maps bind to it most easily), address, borough,
  requiredCapability, reportedAt, estimatedDurationMinutes, roadObstruction,
  safetyRisk, priorityScore, duplicateOf, assignedCrewId, resolvedAt, source.
- Mark editable the fields Actions must change: status, severity, priorityScore,
  duplicateOf, assignedCrewId, resolvedAt (plus the classification fields if
  AIP fills them post-create).

**Crew** (backing: `crews_clean`)
- PK `crew_id`, title `crew_name`.
- Properties per CSV; editable: status, currentWorkload, latitude, longitude.

**Assignment** (backing: `assignments_clean`)
- PK `assignment_id`. All properties editable except the PK (Actions create
  these objects entirely).

**Links**
- Crew ↔ Incident: one-to-many via `Incident.assignedCrewId` → `Crew.crewId`
  ("Crew handles Incidents").
- Assignment → Incident: many-to-one via `incident_id`.
- Assignment → Crew: many-to-one via `crew_id`.
- Incident → Incident: `duplicateOf` self-link ("duplicate of").
- (Optional) Capability object type + links Incident→requires→Capability and
  Crew→has→Capability. Nice for the ontology diagram; the string enums are
  what the code actually uses. Skip if time is tight.

## Phase 3 — Actions (~30 min)

Define Action types on the ontology. These are the ONLY way state changes.

| Action | Parameters | Edits |
|---|---|---|
| **Submit Service Request** | description, latitude, longitude, borough, channel | Create Incident: status=OPEN, reportedAt=now, generated incident_id; classification fields empty until Phase 5 wiring fills them |
| **Assign Crew** | incident (object), crew (object), etaMinutes (int) | Create Assignment (status=EN_ROUTE, estimatedArrival=now+eta); Incident.status=ASSIGNED, assignedCrewId=crew; Crew.status=ON_JOB, currentWorkload+=1 |
| **Escalate Incident** | incident | severity=CRITICAL; recompute priorityScore (function-backed, Phase 4) |
| **Mark Duplicate** | incident, duplicateOf (object) | status=DUPLICATE, duplicateOf=target id. Never deletes |
| **Defer Incident** | incident | severity=LOW (or a deferredUntil timestamp if you add one); recompute priority |
| **Resolve Incident** | incident | Incident.status=RESOLVED, resolvedAt=now; complete the active Assignment; Crew.currentWorkload-=1, status=AVAILABLE if workload hits 0 |

Multi-object edits (Assign, Resolve) are cleanest as **function-backed
actions** — the function computes all edits in one place (see Phase 4) and the
action applies them atomically. If you'd rather avoid function-backed actions,
simple property-edit rules cover a degraded version, but Assign/Resolve really
want the function.

## Phase 4 — TypeScript Functions (~45 min)

1. Create a Code Repository of the **Functions** type, import the ontology
   object types (Incident, Crew, Assignment).
2. Copy `functions/src/dispatch/*.ts` in unchanged — it has zero Foundry
   imports by design.
3. Write thin adapters (in the repo's function entrypoint) that:
   - `recommendCrews(incident)` — reads Crew/Assignment/Incident objects via
     the generated ontology API, maps them to the plain interfaces in
     `types.ts` (Date/number conversions), calls `rankCrews`, returns a
     serializable result: ranked crews with score breakdown + factors +
     ineligible reasons. Workshop consumes this as a function-backed variable.
   - `computeIncidentPriority(incident)` — wraps `computePriorityScore`.
   - `applyAssignment(incident, crew)` — an ontology-edit function backing the
     Assign Crew action: creates the Assignment and applies the edits from the
     Phase 3 table.
   Use the exact decorators/types the repo template generates — don't hand-roll
   imports from memory; start from the template's example function.
4. Run the repo's tests/preview on INC-1001 (expect Crew Alpha, score ≈ 90),
   then publish and tag a version so Workshop/Actions can bind to it.

## Phase 5 — AIP Logic (~45 min)

Create three AIP Logic functions from the specs in `aip/`:
- `classifyIncident` — aip/classify_incident.md
- `confirmDuplicate` — aip/detect_duplicate.md
- `explainRecommendation` — aip/explain_recommendation.md

Use structured/typed outputs; temperature 0 where the block exposes it. Test
each in the Logic debugger with the example inputs in the specs.

**Wiring classification:** simplest reliable pattern — "Submit Service
Request" creates the Incident, and an **Automation** (or a Workshop-triggered
follow-up action) runs `classifyIncident` on new OPEN incidents, then applies
an "Apply Classification" action that writes incidentType, severity,
requiredCapability, roadObstruction, safetyRisk, estimatedDurationMinutes and
the deterministically computed priorityScore. If Automations aren't available
on your tier, a "Classify" button in Workshop that runs Logic + action works
and is arguably better for a narrated demo (you show the AI step happening).

**Wiring duplicates:** after classification, run the deterministic
`findDuplicateCandidates` (exposed via a TS function) and, if candidates exist,
`confirmDuplicate` on the top pair; surface the result in the detail panel.

## Phase 6 — Workshop (~2–3 h including polish)

One page, three zones plus a header:

- **Header metrics** (4 metric cards): open incidents count; critical count;
  available crews; average ETA of active assignments. Back each with an object
  set aggregation.
- **Left — Incident Queue:** object list of Incidents filtered
  status ∈ {OPEN, ASSIGNED, IN_PROGRESS}, sorted priorityScore desc. Row shows
  severity chip, type, address, "reported X min ago". Selection writes to a
  page variable `selectedIncident`.
- **Center — Map:** map widget bound to two layers — Incidents (open, colored
  by severity) and Crews (icon by status). Selecting `selectedIncident`
  centers/zooms the map.
- **Right — Detail panel** for `selectedIncident`:
  - citizen description (verbatim), AIP summary, type/severity/capability/
    priority chips
  - recommendation block: function-backed variable calling `recommendCrews`;
    render winner, score, ETA, factor list, and the `explainRecommendation`
    text; expandable "View alternatives" table with per-crew score breakdown
    and ineligible crews with reasons
  - duplicate banner when flagged (rationale + Mark Duplicate button)
  - buttons: Assign Crew (pre-filled with recommended crew), Escalate,
    Mark Duplicate, Defer, Resolve — each bound to its Action
- **Demo affordance:** a small "Submit Service Request" form (or button opening
  the action form) so you can paste the scenario descriptions live.

Dark theme if available — it reads as a command center on a projector.

## Phase 7 — Demo prep

- Re-run `generate_data.py`, re-upload/refresh datasets so "4 min ago" is true.
- Keep `data/scenario*.csv` descriptions in a scratch doc to paste live.
- Rehearse against `README.md` § Demo script (target: under 4 minutes).
- Have one backup: screen-record a clean run-through in case the live instance
  is slow on demo day.
