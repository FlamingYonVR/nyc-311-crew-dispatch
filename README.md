# NYC 311 Crew Dispatch

An operational command center for city service requests, built on Palantir
Foundry + AIP. A dispatcher watches incoming 311 reports, sees AI-extracted
structure and a deterministic crew recommendation with a full explanation, and
takes actions (assign, escalate, mark duplicate, resolve) that mutate real
Ontology state.

**The operational question:** *which crew should be dispatched to which
incident next?*

## Design philosophy — where AI is (and isn't) allowed

| Concern | Mechanism | Why |
|---|---|---|
| Read a citizen's messy report → type, severity, capability, hazard flags | **AIP Logic** (`aip/classify_incident.md`) | Genuinely ambiguous language; the one job an LLM is best at here |
| "Do these two reports describe the same tree?" | Deterministic pre-filter (geo + time + type) → **AIP Logic** semantic confirm | Code does geometry; the LLM only compares texts that are already plausible pairs |
| Explain a recommendation in plain English | **AIP Logic**, fed only the ranking function's own factor strings | Narration of a decision already made — it cannot change or contradict the ranking |
| Queue priority (0–100) | **Deterministic** `priority.ts` | Reproducible, auditable queue order |
| Who is eligible (skill, shift, queue, locked-on-critical) | **Deterministic** `eligibility.ts` | Hard constraints are never delegated to an LLM |
| Crew ranking + score breakdown | **Deterministic** `scoring.ts` | Weighted, explainable, testable |
| Every state change | **Ontology Actions**, dispatcher-clicked | Human in control; edits are atomic and audited |

## The ranking algorithm (explainable in one breath)

Ineligible crews are filtered first — wrong capability, off shift, queue full,
or locked on a critical job — each exclusion carries a human-readable reason.
Eligible crews score 0–100:

```
score = proximity(40) + availability(25) + workload(20) + severityFit(15)
```

- **proximity** — ETA (5 min mobilization + haversine miles at 12 mph urban
  speed), linear decay to zero at 45 min
- **availability** — full points if free; 30% if already on an interruptible job
- **workload** — scales down with open jobs vs. queue capacity
- **severityFit** — penalizes pulling a crew off equal-or-higher-severity work

Every component emits a factor string; the UI and the AIP explanation both
consume those strings, so what the dispatcher reads is exactly what the
algorithm did.

## Repository layout

```
data/                  synthetic data generator + CSVs (deterministic, seeded)
  generate_data.py     35 incidents / 8 crews / 6 capabilities + 3 live-demo scenario files
functions/             deterministic core — pure TypeScript, zero Foundry imports
  src/dispatch/        types, geo, priority, eligibility, scoring, duplicates,
                       classifier interface (+ keyword mock used only locally)
  src/demo/            local CSV loader + end-to-end vertical-slice runner
  tests/               18 tests incl. the demo narratives
aip/                   AIP Logic specs: prompts + typed I/O contracts, paste-ready
foundry-setup/         ordered build guide for the Foundry side
```

The dispatch core is deliberately portable: in Foundry it's pasted into a
Functions code repository unchanged, behind thin adapters that map Ontology
objects to the plain interfaces in `types.ts`.

## Run the local vertical slice

```bash
cd data && python3 generate_data.py && cd ../functions
npm install
npm test          # 18 tests
npm run demo -- 1 # Atlantic Ave pothole → classify → rank → assign
npm run demo -- 2 # storm: 5 simultaneous reports → queue reprioritizes
npm run demo -- 3 # second report of the Flatbush tree → duplicate flagged
```

## Demo script (< 4 minutes)

**0:00 — The problem.** "NYC gets thousands of 311 reports a day as free text.
Dispatchers must decide which crew goes where next." Show the command center:
queue, map, metrics. Point at the CRITICAL fallen tree on Flatbush Ave, 4 min
old, priority 92.

**0:40 — Scenario 1: one request, end to end.** Paste the Atlantic Ave pothole
report. AIP classifies it (POTHOLE, HIGH, road obstruction, safety risk) —
show the reasoning. Deterministic code turns that into priority 73 and ranks
crews: Golf 86/100 recommended; Bravo qualified but 35/100 — *carrying 3 open
jobs*; four crews ineligible with explicit reasons. Click **Assign Crew** →
incident goes ASSIGNED, Golf goes ON_JOB, an Assignment object exists. "The
button edited the Ontology — that's the system of record, not a dashboard."

**1:50 — Scenario 2: the storm.** Submit five reports in a row. Three arrive
CRITICAL and jump above previously queued medium work — the queue reorders by
the deterministic priority, and each recommendation explains itself (the
drainage crew is already on a flood job, so new flood work queues or waits).

**2:50 — Scenario 3: duplicate.** Submit the second Flatbush tree report. The
geo/time/type pre-filter finds INC-1001 30 meters away; AIP compares the two
texts and flags HIGH-confidence duplicate with a rationale. Click **Mark
Duplicate** — no crew wasted, report preserved.

**3:20 — Close on architecture.** One slide/breath: "LLM only where language is
ambiguous — classification, duplicate confirmation, explanation. Everything
that must be right — eligibility, ranking, priority — is deterministic,
tested TypeScript. Every action is an Ontology edit a dispatcher chose to
make. Impact: minutes shaved off dispatch on every hazard blocking a road."

## Status

- [x] Synthetic data + scenario files
- [x] Deterministic core (priority, eligibility, ranking, duplicate pre-filter) + 18 tests
- [x] Local end-to-end vertical slice (mock classifier standing in for AIP)
- [ ] Foundry: datasets → ontology → actions (foundry-setup/BUILD_GUIDE.md phases 1–3)
- [ ] Foundry: Functions repo adapters (phase 4)
- [ ] AIP Logic: classify / confirm-duplicate / explain (phase 5)
- [ ] Workshop command center (phase 6)
