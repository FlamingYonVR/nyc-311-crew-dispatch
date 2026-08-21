# AIP Logic: Classify Incident

**Purpose:** Turn a citizen's free-text 311 report into the structured fields the
deterministic pipeline needs. This is the one place ambiguous language is
interpreted; everything downstream (priority, eligibility, ranking) is code.

**Build as:** an AIP Logic function with a single LLM block using a structured
output. Locally this is mocked by `KeywordClassifier` in
`functions/src/dispatch/classifier.ts` — same input/output contract.

## Input

| name | type | notes |
|---|---|---|
| `description` | string | raw citizen report text |
| `borough` | string (optional) | caller-reported borough, context only |

## Output (structured — configure as typed fields, not free text)

| field | type | allowed values |
|---|---|---|
| `incidentType` | enum | POTHOLE, FALLEN_TREE, STREETLIGHT_OUT, TRAFFIC_SIGNAL, GRAFFITI, FLOODING, SIDEWALK_HAZARD, ROAD_OBSTRUCTION, DAMAGED_SIGN |
| `severity` | enum | LOW, MEDIUM, HIGH, CRITICAL |
| `requiredCapability` | enum | TREE_REMOVAL, ROAD_REPAIR, ELECTRICAL, DRAINAGE, GENERAL_MAINTENANCE, SIGNAGE |
| `roadObstruction` | boolean | is a travel lane blocked or partially blocked? |
| `safetyRisk` | boolean | immediate danger to people/vehicles? |
| `estimatedDurationMinutes` | integer | typical crew time on site |
| `summary` | string | one sentence, dispatcher-facing |
| `reasoning` | string | 1–2 sentences justifying type + severity |

**Deliberately NOT output by the LLM:** `priorityScore`. The queue order is
computed deterministically from severity/obstruction/safety/age by
`computePriorityScore` (functions/src/dispatch/priority.ts) so it is
reproducible and auditable.

## Prompt (paste into the LLM block)

```
You classify incoming NYC 311 service requests for a city dispatch system.
Read the citizen's report and fill every output field.

Rules:
- Choose incidentType and requiredCapability ONLY from the allowed values.
- Capability mapping: FALLEN_TREE→TREE_REMOVAL; POTHOLE, SIDEWALK_HAZARD→ROAD_REPAIR;
  STREETLIGHT_OUT, TRAFFIC_SIGNAL→ELECTRICAL; FLOODING→DRAINAGE;
  GRAFFITI, ROAD_OBSTRUCTION→GENERAL_MAINTENANCE; DAMAGED_SIGN→SIGNAGE.
- severity reflects urgency of the underlying condition:
  CRITICAL = active danger to people or a blocked major road right now
  HIGH     = significant hazard or disruption, needs same-shift response
  MEDIUM   = real problem, can wait hours
  LOW      = cosmetic or minor, can wait days
- roadObstruction = true only if the report indicates a travel lane is fully or
  partially blocked (vehicles swerving, lane closed, object across road).
- safetyRisk = true only if people or vehicles are in danger now (swerving cars,
  sparking wires, trapped people, trip-and-fall injuries).
- estimatedDurationMinutes: typical values — pothole 45, fallen tree 90,
  streetlight 30, traffic signal 60, graffiti 40, flooding 120, sidewalk 60,
  obstruction 30, sign 25. Adjust up for clearly large jobs.
- summary: one sentence a dispatcher can read in two seconds.
- reasoning: cite the words in the report that drove your severity choice.
- If the report is ambiguous, choose the closest type; never invent facts.
```

## Few-shot examples (add as examples or in the prompt)

Input: "Huge tree came down on Flatbush Ave near the intersection. It's blocking
one lane and cars are swerving around it."
→ incidentType=FALLEN_TREE, severity=CRITICAL, requiredCapability=TREE_REMOVAL,
roadObstruction=true, safetyRisk=true, estimatedDurationMinutes=90,
summary="Fallen tree blocking a lane of Flatbush Ave with traffic swerving around it.",
reasoning="A blocked travel lane with vehicles swerving is an immediate collision
risk, so this is critical."

Input: "Someone spray painted the wall by the park entrance."
→ incidentType=GRAFFITI, severity=LOW, requiredCapability=GENERAL_MAINTENANCE,
roadObstruction=false, safetyRisk=false, estimatedDurationMinutes=40,
summary="Graffiti on the wall at the park entrance.",
reasoning="Cosmetic damage with no hazard mentioned."

## Settings

- Temperature 0 (or the lowest available) — classification, not creativity.
- If structured/typed output is available in your AIP Logic version, use it so
  enum values are enforced by the platform rather than by parsing.

## Wiring

Called by the **Submit Service Request** flow: the action creates the Incident
with the raw description; this function fills type/severity/capability/flags;
then `computePriorityScore` sets the priority. See foundry-setup/BUILD_GUIDE.md.
