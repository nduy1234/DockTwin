# DockTwin

**Live demo:** https://docktwin.vercel.app

**Describe a port terminal in plain English (or show a photo), get a programmable 3D digital twin, and let an agent stress-test it against conflicting real-world signals before a disruption costs you.**

Built for the Meta Global AI Developer Hackathon, track **Push the Frontier** (understanding and controlling a physical system). Every model step runs on Meta models: **Muse Spark**, **SAM 3.1**, and **Muse Voice Transcribe** (plus **Muse Spark Open** on Baseten as an optional stress-scenario provider, off by default).

---

## The problem

A container terminal runs on signals that disagree. The carrier's paperwork says a box is empty; the gate scale says it weighs 24 t. A reefer's sensor reads 7.5 °C; the carrier says the temperature is fine. Customs places a hold just as the box's gate lane goes down, while the free-time clock keeps running. Planners make these calls by hand, under time pressure, using rules that were never tested against these collisions. The cost shows up as demurrage, spoiled cargo, missed vessel windows, and trucks idling at dead lanes.

## The solution

DockTwin is an agent that:

1. **Builds** a twin from a description, spoken or typed, or from a yard/gate photo. Muse Spark writes a structured spec (objects plus `when → then` rules in a small JSON DSL), validated by zod. SAM 3.1 segments the photo into containers, cranes, and lanes that seed the twin.
2. **Stress-tests** it. Seeded scenarios plus adversarial scenarios invented by Muse Spark run through a deterministic simulation. The engine reports behavior bugs: rules that fight at equal priority, rules that never settle, safety rules nobody enforces, rules that never fire, and fields nothing provides. Each Muse Spark scenario also carries **expectations** ("by t=60 this reefer must reach at least *inspect*"), and the engine checks them as test oracles. The same defect on many boxes is grouped into one root cause.
3. **Repairs** the rules. Muse Spark proposes each fix as a rule diff. The engine applies it to a copy and re-runs every scenario. A fix is shown as *verified*, *needs review*, or *rejected*, and nothing is applied without the planner's approval.
4. **Decides** per box, with evidence. It picks the gentlest effective action on a ladder: **watch → ask → slow → reroute → inspect → hold → hand to a human**. Each decision shows which signals were trusted and why (source trust scores), the simulation evidence, a confidence score, and an itemized cost-of-delay estimate. Low-confidence or high-impact actions require human approval. Every step lands in a SHA-256 hash-chained audit log.

**Dual use: "Ordinary Tuesday" creator mode.** The same maker and test agent build interactive objects for games and robotics, such as an automatic door or a robot gripper. The same engine finds interaction bugs, like a door that chatters when someone stands still in the safety beam.

### The core design choice: the model plans, the engine decides

| Muse Spark does | The deterministic engine does |
| --- | --- |
| Turns language and photos into a twin spec | Validates it (zod + semantic checks) and interprets the DSL. It never runs `eval`. |
| Invents adversarial scenarios | Replays them tick by tick with a seeded PRNG |
| Proposes rule fixes as diffs | Applies each diff to a copy and proves or rejects it by re-simulation |
| Explains a decision in plain English | Makes the decision: level, safety floor, confidence, cost, approval |

The same spec, scenario, and seed always give byte-identical results, so every outcome is reproducible and unit-tested.

### Port safety policy

[`src/engine/safety.ts`](src/engine/safety.ts) sets decision floors that do not depend on model output. It runs for a twin with no rules or invariants, and it reads observations that rule `set` actions cannot reach.

| Policy | Floor | Trigger |
| --- | --- | --- |
| `SAFETY-CUSTOMS` | hold | A customs signal or `customs_hold` fact says held. Only a later customs signal releases it. |
| `SAFETY-REEFER-TEMP` | inspect | Latest measured temperature is more than 3 °C above that box's own setpoint. |
| `SAFETY-REEFER-SETPOINT` | ask | A reefer reports a temperature but has no setpoint. |
| `SAFETY-REEFER-POWER` | ask | The box's plug is disconnected or has lost power. |
| `SAFETY-REEFER-TELEMETRY` | ask | A reefer that was reporting has been silent for over 60 minutes. |
| `SAFETY-DECLARED-EMPTY` | inspect | A box declared empty weighs over 5 t. |

Rules cannot write these safety facts (rules may raise `customs_hold` but never clear it), and a fix cannot write a fact an invariant reads. Each finding keeps its observations: source, time, and age.

A twin labelled `creator` that contains port objects, facts, or signal sources is rejected, so the domain label cannot switch the policy off. The server keeps no twin between requests: a client can still remove or relabel objects in the spec it sends, and the policy cannot see what was removed. Treat this as a prototype boundary, not access control.

These thresholds are prototype assumptions in `SAFETY_ASSUMPTIONS`, not validated operational standards. A terminal would replace them with its own procedures. DockTwin is advisory: it recommends actions and changes nothing in the physical terminal, and every active policy, plus any reroute, inspect, hold, or human action, requires human review.

---

## Architecture

```mermaid
flowchart LR
  subgraph Browser["Browser (Next.js client)"]
    UI["Describe / Speak / Photo<br/>3D twin (React Three Fiber)<br/>Stress, Decision, Audit panels"]
    Audit[("Hash-chained<br/>audit log")]
  end

  subgraph Server["Next.js route handlers (keys stay server-side)"]
    Build["/api/build"]
    Voice["/api/transcribe"]
    Seg["/api/segment"]
    Stress["/api/stress"]
    Fix["/api/fix"]
    Explain["/api/explain"]
  end

  subgraph Meta["Meta Model API · api.meta.ai/v1"]
    Spark["Muse Spark<br/>muse-spark-1.3"]
    SAM["SAM 3.1<br/>sam-3.1"]
    MVT["Muse Voice Transcribe<br/>muse-voice-transcribe-1.0"]
  end

  subgraph Engine["Deterministic engine (pure TypeScript)"]
    DSL["DSL interpreter"]
    Sim["Seeded simulation<br/>+ bug detection"]
    Verify["Fix verification"]
    Decide["Trust · cost · ladder<br/>approval policy"]
  end

  UI --> Voice --> MVT
  UI --> Seg --> SAM
  Seg -->|vision: read box codes| Spark
  UI --> Build -->|json_schema| Spark
  UI --> Stress -->|adversarial scenarios| Spark
  Stress --> Sim
  UI --> Fix -->|rule diff| Spark
  Fix --> Verify --> Sim
  UI --> Explain -->|explain only| Spark
  UI --> Decide
  Sim --> DSL
  UI --> Audit
```

## Meta models, and where each one is used

| Model | ID | Endpoint | Used for | Code |
| --- | --- | --- | --- | --- |
| Muse Spark | `muse-spark-1.3` | `POST /v1/chat/completions` with `response_format: json_schema` | Describe → twin spec (text, or text + photo objects) | [`api/build`](src/app/api/build/route.ts), [`lib/meta/spark.ts`](src/lib/meta/spark.ts) |
| Muse Spark | `muse-spark-1.3` | same | Stress agent: invents adversarial scenarios plus expectations the engine checks | [`lib/meta/agents.ts`](src/lib/meta/agents.ts) `sparkScenarios` |
| Muse Spark Open (optional, off by default) | `meta-models/muse-spark-open-1026` | Baseten `POST /v1/chat/completions` (OpenAI-compatible) | Alternate stress-agent scenario provider when `SCENARIO_PROVIDER=baseten` + `BASETEN_API_KEY`; any failure falls back to Muse Spark, both calls logged | [`lib/meta/baseten.ts`](src/lib/meta/baseten.ts) |
| Muse Spark | `muse-spark-1.3` | same | Fix agent: proposes rule diffs | `sparkFix` |
| Muse Spark (vision) | `muse-spark-1.3` | same, with image input | Reads container codes and reefer units inside SAM's boxes | `sparkLabelBoxes` |
| Muse Spark | `muse-spark-1.3` | same | Explains an engine decision (cannot change it) | [`api/explain`](src/app/api/explain/route.ts) |
| SAM 3.1 | `sam-3.1` | `POST /v1/responses` (streamed), decoded with `@meta-sam/parser` | Photo → containers, cranes, lanes (boxes + masks) | [`lib/meta/sam.ts`](src/lib/meta/sam.ts) |
| Muse Voice Transcribe | `muse-voice-transcribe-1.0` | `POST /v1/asr/transcribe` (multipart: JSON `request` + WAV `audio`) | Spoken descriptions, biased toward terminal vocabulary | [`lib/meta/voice.ts`](src/lib/meta/voice.ts) |

Endpoints and IDs follow [dev.meta.ai/docs](https://dev.meta.ai/docs/models) and the [Meta Model cookbook](https://github.com/meta-models/meta-model-cookbook). The UI shows which Meta model handled each step, with latency, retries, and schema repairs. The audit log records the model behind every action.

Developed with a coding agent running on Muse Wonder (`muse-wonder-1.0`) via the Meta Model API.

**Measured live (Nov 3, 2026).**
- Describe → twin: about 19 s with `reasoning_effort: "low"`. The default took about 38 s with no quality gain for this task.
- Demo mode, from click to every fix verified (scenario agent plus parallel fix agents): about 40 s. In that run, the engine verified every fix Muse Spark proposed.
- SAM 3.1, three noun phrases in parallel: about 2 s.
- Vision code reading: 17–33 s.
- Voice transcription of an 11 s clip: about 3 s.

**Reliability.** Retries use exponential backoff with jitter; 400s are never retried. Structured output is decoded against the JSON Schema, then zod-parsed and semantically checked. Problems go back to the model for up to two repair rounds. If a Muse Spark scenario or fix call fails, the run continues with seeded scenarios, and a clearly labeled engine-heuristic fix is offered instead.

---

## Setup

Requirements: Node.js ≥ 20.17 and a Meta Model API key from [dev.meta.ai](https://dev.meta.ai).

```bash
git clone https://github.com/nduy1234/DockTwin.git
cd DockTwin
npm install
cp .env.example .env.local   # then set MODEL_API_KEY
npm run dev                  # http://localhost:3000
```

```bash
npm test          # 466 tests in 13 files (Vitest)
npm run typecheck
npm run build
npm run smoke     # live check of all 6 routes against a running app (real Meta calls; fails on any mock)
```

**Offline mock mode (local development only).** Set `MOCK_META=1` in `.env.local` to run without a key. Every mocked call is labeled `MOCK` in the UI and in the audit log. Mock mode is refused on a Vercel production deployment. The demo and the video use real Meta model calls.

**Deploy.** Import the repo in Vercel and set `MODEL_API_KEY` as an environment variable. Route handlers run on the Node.js runtime; no model key ever reaches the browser.

## Demo walkthrough (about 3 minutes)

1. **▶ Demo mode** loads *Pacific Gate Container Terminal* (fictional): 100 boxes, 4 gate lanes, 3 cranes, and one problem box, reefer **MSCU7154023** at Lane 3. It immediately runs a stress test, with Muse Spark inventing extra scenarios and proposing fixes, then replays the **Perfect storm** in 3D.
2. Scrub the timeline. Boxes light up by ladder level. Click the problem box: its state shows `gate_route=fast_lane`, the live effect of a bug.
3. **Behavior bugs:**
   - Rules R4 and R5 fight over the gate route at equal priority, so a heavy box declared "empty" gets fast-laned.
   - The reefer rule trusts the carrier's "temp OK" over the sensor, which violates the safety rule *>3 °C above setpoint ⇒ inspect*.
   Each fix arrives as a diff with **VERIFIED** (re-run across all scenarios). Approve each to apply; once both are applied, the seeded scenarios run clean.
4. **Decisions:** pick the reefer scenario at t=40.
   - The action is *inspect*, and the port safety policy is active.
   - The sensor (trust 0.90) overrides the carrier (0.30 after contradiction).
   - The evidence score is 0.72 before the reefer fix and 0.73 after it, with an itemized cost estimate.
   - The card is marked **needs human approval**.
   Approve it, override it with a reason, or hand it to a supervisor. Click **Explain (Muse Spark)**.
5. **Voice / photo:** speak a new description, or open *Photo → Twin* and segment the *Box stack* sample. SAM 3.1 finds about 33 boxes, and Muse Spark vision reads their real container codes.
6. **Creator mode:** switch tabs and build the automatic door. The stress test finds the chattering door (R2/R3 never settle when someone stands still in the beam) and the unhandled power loss, then verifies the fixes. Same engine, different template.
7. **Audit log:** every step, with the Meta model that acted, hash-chained and exportable.

See [DEMO.md](DEMO.md) for the timed video script.

## Repository map

```
src/engine/      deterministic core: schema + DSL, interpreter, sim, scenarios,
                 fix verification, trust, cost, decision ladder, audit, layout, demo
src/lib/meta/    Meta Model API clients (Spark, SAM, Voice), retries, agents, mock mode
src/templates/   domain templates: port terminal, creator mode
src/app/api/     route handlers: build, transcribe, segment, stress, fix, explain
src/components/  3D twin, inspector, stress, decision, photo, audit panels
tests/           Vitest unit tests + golden test (tests/golden/demo.json)
public/samples/  public-domain / CC0 sample photos (see LICENSES.md)
```

## Built during the hackathon (Oct 27 – Nov 4, 2026)

Everything in this repository was written during the building period. The only earlier commit (`63306d1`, Oct 26) is GitHub's generated repository scaffold: an MIT `LICENSE`, a one-line `README.md`, and a template `.gitignore`. It contains no code.

| Date | Commit | What was built |
| --- | --- | --- |
| Oct 29 | `c39db99` | Next.js app; zod twin schema + rule DSL that doubles as the Muse Spark JSON Schema; Meta client with retries, schema repair, model-call log, mock mode; Describe → Build |
| Oct 29 | `8f78648` | Deterministic DSL interpreter; seeded simulation with conflict / oscillation / invariant / dead-rule / unknown-fact detection; 3D layout and clickable twin |
| Oct 29 | `ec1e939` | Scenario generator and threshold fuzzer; Muse Spark scenario and fix agents; fix verification by re-simulation; stress panel with replay |
| Oct 29 | `bc1d9f2` | Source trust and contradiction resolution; cost-of-delay model; decision ladder with safety floor, confidence, approval policy; hash-chained audit log; Muse Spark explanations |
| Oct 29 | `b36fa81` | Muse Voice Transcribe (browser WAV capture); SAM 3.1 photo segmentation + Muse Spark vision labels → twin objects; bundled sample photos |
| Oct 29 | `528c79d` | "Ordinary Tuesday" creator mode: creator template, generic interaction stress, door/gripper meshes |
| Oct 29 | `b741d8f` | Demo mode (seeded 100-box terminal), animated replay, golden test, README, DEMO.md |
| Nov 3 | `9b5482b` | First live runs against the Meta Model API: latency tuning, SAM noun phrases chosen from measurements, stress-agent expectations as engine-checked oracles, root-cause grouping of bugs, stack-tier fix |
| Nov 3 | `a6cae1e` | Time budgets: one deadline per model call across retries and repair rounds, 60 s per attempt, every route's worst case under 240 s; cited the $68B source |
| Nov 3 | `f5e7419` | `scripts/smoke.ts`: live smoke test of all six routes (`npm run smoke`) |
| Nov 3 | `b30790e` | README: fill in the `f5e7419` hash in the built-during table |
| Nov 3 | `554f648` | Honest model-usage note: coding agent on Muse Wonder (`muse-wonder-1.0`) via the Meta Model API |
| Nov 3 | `b968021` | Deployed to Vercel (`docktwin.vercel.app`); production smoke test passes all six routes on real Meta models |
| Nov 3 | `b38cf3d` | Optional Muse Spark Open on Baseten as stress-agent scenario provider (env-flagged, default off, Muse Spark fallback) |
| Nov 3 | `d1c5f53` | README: add the `b38cf3d` row to this table |
| Nov 3 | `1e7343d` | Vinayak Tiwari: port safety hardening — `src/engine/safety.ts` safety-policy decision floors wired into sim/verify/decide, plus safety, safety-regression, and integration-hardening tests |
| Nov 3 | `e08eabe` | Merge of PR #2 (vinayak/safety-integration): port safety policy integrated onto latest main |
| Nov 3 | `3b8f71b` | README: complete this table (`d1c5f53`, `1e7343d`, `e08eabe` rows) |
| Nov 3 | `b1c69df` | README: add Team section |
| Nov 3 | `f890a25` | README: refresh test count (466 tests in 13 files), note optional Muse Spark Open provider |
| Nov 3 | `8579b0b` | DEMO.md: align the 3-minute script with the judging rubric (impact, Meta tooling, technical depth, end card) |

Third-party code is used only as npm dependencies (Next.js, React, three.js / React Three Fiber / drei, zod, the OpenAI SDK pointed at the Meta Model API, `@meta-sam/parser`, Tailwind, Vitest). Sample photos are public domain or CC0; see [`public/samples/LICENSES.md`](public/samples/LICENSES.md).

## Team

- **Day Nguyen**: product design and growth (product, UX, demo, pitch) · [linkedin.com/in/daynguyen](https://linkedin.com/in/daynguyen)
- **Vinayak Tiwari**: software engineer (port safety policy and hardening) · [linkedin.com/in/vinayak09](https://linkedin.com/in/vinayak09)

## License

[MIT](LICENSE)
