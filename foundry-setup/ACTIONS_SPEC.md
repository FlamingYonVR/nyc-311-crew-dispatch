# Action & Link Specification

What to build in Ontology Manager. Every state change in the app goes through
one of these actions — nothing writes to datasets directly.

API names below are the pluralized forms Foundry generated:
`Incidents`, `Crews`, `Assignments`.

---

## Links

Foundry has no public write API for link types (POST /linkTypes -> 404), so
these are created in Ontology Manager > Link types > New.

| Link | From | To | Cardinality | Join |
|---|---|---|---|---|
| `assignedCrew` | Incidents | Crews | many-to-one | `Incidents.assignedCrewId` = `Crews.crewId` |
| `assignmentIncident` | Assignments | Incidents | many-to-one | `Assignments.incidentId` = `Incidents.incidentId` |
| `assignmentCrew` | Assignments | Crews | many-to-one | `Assignments.crewId` = `Crews.crewId` |
| `duplicateOf` | Incidents | Incidents | many-to-one (self) | `Incidents.duplicateOf` = `Incidents.incidentId` |

The self-link is what makes "Mark Duplicate" non-destructive: the report is
preserved and points at the original rather than being deleted.

---

## Actions

### 1. Assign Crew  *(the important one — multi-object)*

The only action that touches three objects at once. Best implemented as a
function-backed action so the edits apply atomically.

**Parameters**
- `incident` — Incidents object
- `crew` — Crews object
- `etaMinutes` — integer (supplied by the ranking function)

**Edits**
1. CREATE `Assignments`
   - `assignmentId` = generated (e.g. `ASG-` + timestamp)
   - `incidentId` = incident.incidentId
   - `crewId` = crew.crewId
   - `assignedAt` = now
   - `estimatedArrival` = now + etaMinutes
   - `status` = `EN_ROUTE`
2. MODIFY `Incidents`
   - `status` = `ASSIGNED`
   - `assignedCrewId` = crew.crewId
3. MODIFY `Crews`
   - `status` = `ON_JOB`
   - `currentWorkload` = currentWorkload + 1

**Guard:** the UI only offers crews returned by `rankCrews`, which has already
enforced skill / shift / capacity / critical-lock. The action does not re-run
eligibility — that logic lives in one place.

---

### 2. Escalate Incident

**Parameters:** `incident`

**Edits:** MODIFY `Incidents`
- `severity` = `CRITICAL`
- `priorityScore` = recomputed by `computePriorityScore` (function-backed)

Used when a dispatcher has information the caller did not convey.

---

### 3. Mark Duplicate

**Parameters:** `incident`, `duplicateOf` (Incidents object)

**Edits:** MODIFY `Incidents`
- `status` = `DUPLICATE`
- `duplicateOf` = duplicateOf.incidentId

**Never deletes.** The duplicate report stays queryable and linked to the
original — important for audit and for 311 reporting volume.

---

### 4. Defer Incident

**Parameters:** `incident`

**Edits:** MODIFY `Incidents`
- `severity` = `LOW`
- `priorityScore` = recomputed

Drops the incident down the queue without closing it. The capped aging bonus
in `priority.ts` guarantees it resurfaces rather than being starved forever.

---

### 5. Resolve Incident

**Parameters:** `incident`

**Edits**
1. MODIFY `Incidents`
   - `status` = `RESOLVED`
   - `resolvedAt` = now
2. MODIFY the active `Assignments` row for this incident
   - `status` = `COMPLETED`
   - `completedAt` = now
3. MODIFY `Crews`
   - `currentWorkload` = max(0, currentWorkload - 1)
   - `status` = `AVAILABLE` if resulting workload = 0, else `ON_JOB`

Multi-object, so function-backed like Assign Crew.

---

## Auto-generated actions already present

`create-incidents`, `create-assignments`, `edit-assignments`, `edit-crews`.

Keep `create-incidents` — it backs "Submit Service Request" in the demo.
The generated edit actions are building blocks; the five above are the
operational vocabulary the dispatcher actually sees.

## Deliberately absent

No delete action on any object type. Incidents are resolved or marked
duplicate; crews and assignments are never removed. An operational system of
record should not lose history.
