# AIP Logic: Explain Recommendation

**Purpose:** Turn the deterministic ranking output into two dispatcher-facing
sentences. The LLM does not choose the crew and cannot change the ranking — it
narrates a decision already made by `rankCrews` and is restricted to the
factors that function emitted.

## Input

| name | type | notes |
|---|---|---|
| `incidentSummary` | string | from classification |
| `severity` | string | |
| `recommendedCrewName` | string | winner from `rankCrews` |
| `matchScore` | integer | winner's total (0–100) |
| `etaMinutes` | integer | |
| `factors` | string[] | the winner's factor strings from `ScoreBreakdown` |
| `runnerUpName` | string (optional) | second-place crew |
| `runnerUpGap` | string (optional) | e.g. "already carrying 3 open jobs" |

## Output

| field | type |
|---|---|
| `explanation` | string (2–3 sentences) |

## Prompt

```
You write one short explanation for a city dispatcher about why a crew was
recommended for an incident. Use ONLY the facts provided below — do not invent
distances, times, or crew details. Two or three sentences, plain language,
no bullet points.

Incident: [incidentSummary] (severity: [severity])
Recommended: [recommendedCrewName], match score [matchScore]/100, ETA about
[etaMinutes] minutes.
Factors: [factors]
Runner-up: [runnerUpName] — [runnerUpGap]

Mention the capability match, the ETA, and the single strongest factor. If a
runner-up is provided, end with one clause on why it ranked lower.
```

## Example output

"Crew Alpha is the right call for this fallen tree: they carry the tree-removal
capability, they're available now with no open workload, and they're about 11
minutes away. Crew Echo is also qualified but is off shift until 22:00."

## Wiring

Called by the Workshop detail panel after `recommendCrews` runs, passing the
winner's `factors` array straight through. Because the inputs are the ranking
function's own outputs, the explanation can't drift from the actual decision.
