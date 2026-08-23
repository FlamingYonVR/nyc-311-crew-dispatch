# Demo script — NYC 311 Crew Dispatch

Target: **under 4 minutes**, unlisted YouTube, emailed to your recruiter.
Palantir asks you to cover: why this problem, who the user is, the impact,
and the technical choices. The beats below are ordered to hit all four.

---

## Before you hit record (5 minutes)

1. **Refresh the data so timestamps read "minutes ago":**
   ```bash
   cd ~/Desktop/Jobs/Palantir/nyc-311-crew-dispatch/data && python3 generate_data.py
   ```
   (Optional — only needed if you want Foundry to match. Re-upload the four
   CSVs and re-run `apply_schemas.py` with `FOUNDRY_HOST` set.)

2. **Open these three tabs, in this order:**
   - The app:
     `/workspace/module/view/latest/ri.workshop.main.module.7e65cddb-fff0-4c16-b6f7-1d636740d6e3`
   - AIP Logic → **Classify Incident** (leave the preview result on screen)
   - Ontology Manager → **Incidents** object type

3. **Have a terminal ready** in `nyc-311-crew-dispatch/functions`.

4. **In the app, click the "Priority Score" column header** so the queue sorts
   descending. The Flatbush Ave fallen tree (92) should sit on top.

---

## The script

### 0:00–0:35 — The problem and the user

> "New York's 311 line takes service requests as free text. A dispatcher has
> to turn 'a tree came down and cars are swerving' into a decision: which of
> my crews goes there, and ahead of what other work. That decision gets made
> hundreds of times a shift, under load. My user is that dispatcher, and this
> is the tool the decision happens in — not a dashboard that reports on it
> afterwards."

Show the app. Point at the queue sorted by priority.

### 0:35–1:15 — AIP does the reading

Switch to the AIP Logic tab. Show the input text and the result:

```json
{ "incidentType": "FALLEN_TREE",
  "severity": "CRITICAL",
  "requiredCapability": "TREE_REMOVAL" }
```

> "This is AIP Logic. Raw citizen text in, structured incident out. Notice it
> returned CRITICAL — a fallen tree is normally HIGH in my rules, but the
> report says a lane is blocked and cars are swerving, so it escalated. That
> judgment about language is exactly what a model should be doing."

**Then the important line:**

> "Notice what it does *not* return: a priority score. The model never does
> arithmetic and never picks a crew."

### 1:15–2:15 — Deterministic code does the deciding

Switch to the terminal:

```bash
npm run demo -- 1
```

Point at three things on screen:

1. **The excluded crews** — "Six crews are eliminated before anything is
   ranked: wrong capability, off shift, at capacity. Every exclusion carries a
   reason, so when the dispatcher asks 'why not Delta?' there's an answer."
2. **The score breakdown** — "Golf scores 86, Bravo 35. Same skill, same
   borough. The gap is workload: Bravo is already carrying three jobs. That's
   proximity 40, availability 25, workload 20, severity-fit 15 — no hidden
   terms."
3. **The tests** — optional, if you have seconds spare:
   ```bash
   node dist/tests/dispatch.test.js
   ```
   "Eighteen tests, because this logic is deterministic and therefore
   testable. That's the whole reason it isn't in the model."

### 2:15–3:05 — The action changes real state

Back to the app. Select the fallen tree. Click **Assign Crew**, fill the form
(status ASSIGNED, crew CRW-A), submit.

> "That button is an Ontology Action. It didn't update a chart — it wrote to
> the Incident object. The crew link now resolves, the incident leaves the
> open queue, and any other view of this data sees the change. That's the
> difference between an analytics tool and a system of record."

Show the row updating.

### 3:05–3:45 — Architecture and impact

Switch to Ontology Manager → Incidents. Show the object type and its links.

> "Three object types — Incidents, Crews, Assignments — and four links,
> including a self-link so a duplicate report points at the original instead
> of being deleted. Nothing is ever destroyed; this is a record.
>
> The split I'd defend in review: AIP interprets language and explains
> decisions. Deterministic TypeScript owns every constraint that has to be
> right — eligibility, ranking, priority. A human commits every state change.
>
> Impact: minutes off every dispatch on hazards that are actively blocking
> roads, and an audit trail for why each crew was sent."

### 3:45–4:00 — Close

> "Everything you saw runs on synthetic data modelled on real NYC geography,
> no PII. The dispatch logic is a portable TypeScript module — the same code
> runs under unit test outside Foundry and inside a Functions repository in
> it."

---

## If asked "what would you build next?"

1. Duplicate detection is written and specced (`aip/detect_duplicate.md`) —
   deterministic geo/time pre-filter, then AIP compares the two texts.
2. The explanation function, fed only the ranking's own factor strings so it
   cannot contradict the algorithm.
3. Map widget on the incident lat/lon.
4. Live 311 feed via Pipeline Builder instead of seeded CSVs.

## Things to be precise about on camera

- The **local terminal demo uses a keyword stand-in**, not a model. Say so.
  The real classification is the AIP Logic function you showed. The seam is
  deliberate: everything downstream depends only on the `Classification`
  interface.
- The queue sort is done by clicking the column header — do it before
  recording so it looks settled.
- Say "synthetic data" once, early. It removes the obvious question.
