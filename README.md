# NYC 311 Crew Dispatch

An operational command center for city service requests, built on Palantir
Foundry + AIP. A dispatcher watches incoming 311 reports, sees AI-extracted
structure and a deterministic crew recommendation with a full explanation, and
takes actions (assign, escalate, mark duplicate, resolve) that mutate real
Ontology state.

**The operational question:** *which crew should be dispatched to which
incident next?*

## Quickstart

```bash
cd functions && npm install
npm run demo -- 1   # one request end to end: classify -> rank -> assign
npm run demo -- 2   # storm: five reports at once, queue reprioritizes
npm run demo -- 3   # duplicate detection
node dist/tests/dispatch.test.js   # 18 tests, printed individually
```

Needs Node 18+ and Python 3. No API keys, no network.

**Live in Palantir Foundry:** AIP Logic classification, a three-object
Ontology with four links, an Ontology Action that changes operational state,
and a Workshop dispatcher application. See
[foundry-setup/AS_BUILT.md](foundry-setup/AS_BUILT.md) for exactly what was
built and the platform gotchas hit along the way, and [DEMO.md](DEMO.md) for
the demo script.

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

The dispatch core is deliberately portable: it runs under `node --test` here
and goes into a Foundry Functions repository unchanged (pushed over git to
`/stemma/git/<repo-rid>`), behind thin adapters that map Ontology objects onto
the plain interfaces in `types.ts`.

## Demo script

See [DEMO.md](DEMO.md) — a timed, four-minute script with the exact
commands, the tabs to have open, and the claims to be careful about on
camera.

## Status

Local (all green):
- [x] Synthetic data generator + three scenario files
- [x] Deterministic core: priority, eligibility, ranking, duplicate pre-filter
- [x] 18 tests, including the three demo narratives
- [x] End-to-end vertical slice runner

In Foundry:
- [x] Datasets (4, typed) and Ontology (Incidents / Crews / Assignments)
- [x] Four object links, verified traversing real data
- [x] AIP Logic **Classify Incident** — published, ontology-bound, verified
- [x] Ontology Action **Update Incident** — verified changing state via API
- [x] Workshop application — published v0.7.0: priority-first incident queue
      (Priority Score / Severity / Incident Type / Address), a live
      "Open Incidents" metric backed by an object set aggregation that
      recounts as the dispatcher filters, and an Assign Crew button wired
      to the Update Incident action
- [x] Functions repo: dispatch core + recommendCrews / assignCrew /
      resolveIncident pushed over git
- [ ] Functions: import object types via the Palantir sidebar so
      `@ontology/sdk` resolves, then publish
- [ ] AIP Logic: duplicate confirmation and operator explanation (specs
      written in `aip/`)
