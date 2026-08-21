# AIP Logic: Confirm Duplicate

**Purpose:** Judge whether two reports describe the same real-world incident.

**Two-stage design (the demo talking point):**
1. **Deterministic pre-filter** (`functions/src/dispatch/duplicates.ts`): only
   pairs with the same incidentType, within 0.25 miles, reported within 180
   minutes become candidates. Code does geometry and time — the LLM never
   compares a Queens pothole to a Staten Island pothole.
2. **AIP semantic comparison** (this function): given one candidate pair, judge
   whether the *texts* plausibly describe the same event.

The dispatcher always confirms via the **Mark Duplicate** action; AIP only
flags.

## Input

| name | type |
|---|---|
| `newDescription` | string |
| `existingDescription` | string |
| `distanceMiles` | double (from the pre-filter, context) |
| `minutesApart` | integer (context) |

## Output (structured)

| field | type | notes |
|---|---|---|
| `isLikelyDuplicate` | boolean | |
| `confidence` | enum | LOW, MEDIUM, HIGH |
| `rationale` | string | 1–2 sentences quoting the overlapping details |

## Prompt

```
Two NYC 311 reports of the same incident type were filed [minutesApart] minutes
apart, [distanceMiles] miles from each other. Decide whether they most likely
describe the SAME real-world incident or two different ones.

Report A (existing): [existingDescription]
Report B (new): [newDescription]

Consider: same street/landmark names, same described object or damage, and
details that CONTRADICT each other (different cross streets, different objects,
"northbound" vs "southbound"). Two similar problems on the same long avenue can
be different incidents — matching landmarks matter more than matching nouns.

isLikelyDuplicate: your judgment.
confidence: HIGH only if location details corroborate; MEDIUM if descriptions
match but location wording is vague; LOW otherwise.
rationale: one or two sentences citing the specific matching or conflicting
details a dispatcher should check.
```

## Example

A: "Huge tree came down on Flatbush Ave near the intersection with 7th Ave.
It's blocking one lane completely and cars are swerving around it."
B: "There's a big tree that fell across Flatbush Avenue right by the 7th Ave
intersection. One lane is totally blocked and traffic is a mess."
→ isLikelyDuplicate=true, confidence=HIGH,
rationale="Both name Flatbush Ave at 7th Ave, a downed tree, and one blocked
lane; no contradicting details."

## Wiring

Runs when a new incident is created and the pre-filter returns candidates
(top candidate only). If `isLikelyDuplicate`, the Workshop detail panel shows a
"Possible duplicate of INC-xxxx" banner with the rationale and a **Mark
Duplicate** button. That action sets `status=DUPLICATE` and
`duplicateOf=<incidentId>` — it never deletes the report.
