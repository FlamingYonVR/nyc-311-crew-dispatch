# As-built record

Built against a Foundry developer-tier instance. Host and RIDs below are
specific to that stack; set `FOUNDRY_HOST` to point the scripts at your own.

## Phase 1 — datasets (DONE, via REST API)
Project: NYC 311 Crew Dispatch — ri.compass.main.folder.4589d949-4115-48eb-9c93-89a92f14b6b1
data/ folder: ri.compass.main.folder.078157bd-d487-404e-8546-0d5067b2648b
Datasets (rids in ./rids/): incidents, crews, assignments, capabilities
Schemas: applied via PUT /api/v1/datasets/{rid}/schema?preview=true (see apply_schemas.py)

Gotchas encountered (keep for the writeup):
- CSVs must use \n line endings to match schema recordDelimiter (csv module defaults to \r\n).
- TIMESTAMP columns require an explicit per-column entry in textParserParams.dateFormat;
  pattern "yyyy-MM-dd'T'HH:mm:ssXXX" parses our ISO-8601-with-offset values.
- readTable can serve a stale cached failure for a while after a schema fix; re-apply
  schema / wait and re-read before concluding the schema is wrong.
- Re-uploading a file (new SNAPSHOT transaction) clears the schema; re-apply after upload.
  => demo refresh procedure: python3 generate_data.py -> upload 4 files -> python3 apply_schemas.py

## Phase 2 — ontology: IN PROGRESS (via Ontology Manager UI)

## Phase 2 — Ontology (DONE, via Ontology Manager UI)
Ontology: Yawnner Ontology (ontology-584129ba-7b99-4eaa-b6ac-aa4b7d91d80f)

Object types (all live and indexed):
  Incidents    pk=incidentId    19 properties   35 objects
  Crews        pk=crewId        12 properties    8 objects
  Assignments  pk=assignmentId   7 properties   10 objects

Auto-generated action types:
  create-incidents, create-assignments, edit-assignments, edit-crews

Notes / gotchas:
- There is NO public write API for object types on this tier
  (POST /api/v2/ontologies/{ont}/objectTypes -> 404). The Ontology Manager UI
  is the only path; datasets/schemas remain fully scriptable via REST.
- After "Save to ontology", object queries return errorName
  OntologySyncingObjectTypes for ~1 minute while indexing runs. Poll until
  the object list returns rows before demoing.
- Object types were created singular in intent but the wizard pluralizes the
  API name (Incidents/Crews/Assignments) — that's what code must reference.

## Phase 3a — Links (DONE, via Ontology Manager UI)
All four verified traversing real data via the objects/{id}/links/{link} API:

  Incidents.crew              -> Crews        [ONE]   fk assignedCrewId = crewId
  Incidents.assignments       -> Assignments  [MANY]  (reverse)
  Incidents.originalIncident  -> Incidents    [ONE]   fk duplicateOf = incidentId
  Incidents.duplicateReports  -> Incidents    [MANY]  (reverse, self-link)
  Assignments.incident        -> Incidents    [ONE]
  Assignments.crew            -> Crews        [ONE]
  Crews.incidents             -> Incidents    [MANY]  (reverse)
  Crews.assignments           -> Assignments  [MANY]  (reverse)

Gotchas:
- A link's API name may NOT collide with an existing property API name.
  `duplicateOf` was rejected as Invalid because the property of that name
  exists; renamed the link to originalIncident / duplicateReports.
- Driving these dropdowns: plain clicks on list items are ignored. The working
  pattern is: click the dropdown -> click its search input -> TYPE to filter
  -> click the single remaining row. Synthetic JS click events are filtered
  out by the app entirely.
- "Save to ontology" opens a confirm popover that does not always appear in a
  screenshot immediately; query the DOM for the portal instead of trusting a
  stale capture.

## Phase 3b — Custom actions: NEXT
See ACTIONS_SPEC.md. Assign Crew and Resolve are multi-object and want
function-backed actions, so the Functions repo (phase 4) comes first for those.
Escalate / Mark Duplicate / Defer are simple property edits and can be built now.

## Phase 5a — AIP Logic: Classify Incident (DONE, published)

Resource: /Yawnner-d16e2c/NYC 311 Crew Dispatch/Classify Incident
Type: EDDIE_LOGIC   rid: ri.eddie.main.logic.6737b36b-47a0-4648-b31c-245325876143
Bound to: Yawnner Ontology     Status: Published

Shape:
  input   description : String (required)
  block   Use LLM (GPT-5.6 Sol), ~1500-char system prompt carrying the
          classification rules from aip/classify_incident.md
  output  Struct{ incidentType: String, severity: String,
                  requiredCapability: String }

Verified preview run (3.93s), input = the Flatbush Ave fallen-tree report:
  { "incidentType": "FALLEN_TREE",
    "severity": "CRITICAL",
    "requiredCapability": "TREE_REMOVAL" }

Note the model returned CRITICAL rather than the FALLEN_TREE base of HIGH,
because the report mentions a blocked lane and swerving traffic — the
escalation rule in the system prompt working as intended.

Deliberately NOT returned by the LLM: priorityScore. Priority stays
deterministic (functions/src/dispatch/priority.ts).

Reduced scope vs. the original spec: roadObstruction, safetyRisk,
estimatedDurationMinutes, summary and reasoning were dropped from the struct.
The struct editor popover in AIP Logic stops accepting input after ~3 fields,
and the three kept fields are the ones that actually drive routing (type ->
capability -> eligible crews, severity -> priority base). Duration falls back
to the per-type default already in the code.

Gotchas:
- Publishing requires binding the function to an ontology first
  (Publish -> Configuration -> "Bound to the following ontologies").
- The task-prompt editor inserts a /variable chip at the caret and resists
  programmatic clearing; the variable ended up before the instruction text.
  Functionally fine (report then instruction) but worth tidying by hand.

## Phase 4 — Functions repo (code pushed; ontology import outstanding)

Repo: /Yawnner-d16e2c/NYC 311 Crew Dispatch/dispatch-functions
Type: STEMMA_REPOSITORY  rid: ri.stemma.main.repository.9a833b05-ebfd-48be-aafc-83b321e1ec91
Template: TypeScript Functions V2 (OSDK v2, @osdk/functions 1.20.0)

*** The repo is a real git remote and accepts pushes: ***

    git clone https://:$TOKEN@<host>/stemma/git/<repo-rid>

That is by far the fastest way to get code in — no web editor required.
`git ls-remote` against that URL returns master, and a normal `git push`
works. Foundry picked the functions up immediately (they appear in the
VS Code FUNCTIONS > Live preview list).

Pushed (commit 423e80f):
  src/dispatch/*            the deterministic core, copied verbatim except
                            NodeNext .js import extensions and one fix for
                            noUncheckedIndexedAccess in the shift parser
  src/functions/recommendCrews.ts   read-only; returns ranked eligible crews
                            with the score breakdown AND excluded crews with
                            reasons
  src/functions/assignCrew.ts       edit fn; Incident + Crew in one edit batch
  src/functions/resolveIncident.ts  edit fn; closes incident, frees the crew

REMAINING (needs a human in VS Code for the Web):
  The object types must be imported via the Palantir "Resource imports"
  sidebar so `@ontology/sdk` resolves — resources.json is still empty, which
  is why PROBLEMS shows unresolved imports. AGENTS.md in the repo says this
  step "most likely needs human intervention" and that matches what I hit:
  VS Code runs in a cross-origin iframe, so neither DOM inspection nor
  keyboard shortcuts (cmd+shift+P) reach it. Clicking blind by screenshot is
  possible but unreliable.

  To finish: open the repo in Foundry, Palantir sidebar -> resource imports,
  add object types Incidents, Crews, Assignments, then Publish/Tag version.

## API surface learned from the repo's own AGENTS.md (worth keeping)
  - one registered function per file; default export; file name == fn name
  - `client: Client` is always the first param when touching the Ontology
  - `Osdk.Instance<T>` for objects, `ObjectSet<T>` for sets
  - edits via `createEditBatch<OntologyEdit>(client)` then `batch.getEdits()`
  - one-to-many links are set by updating the FK holder, not batch.link()
  - relative imports need the .js extension even from .ts sources
