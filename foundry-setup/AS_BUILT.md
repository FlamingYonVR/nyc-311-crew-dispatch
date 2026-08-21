# As-built record (dev-tier instance: yawnner.usw-16.palantirfoundry.com)

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

## Phase 3 — Custom actions: NEXT
Still to build (the real workflow actions):
  Assign Crew, Escalate Incident, Mark Duplicate, Defer, Resolve Incident
  + links: Incident->Crew, Assignment->Incident, Assignment->Crew, Incident->Incident (duplicateOf)
