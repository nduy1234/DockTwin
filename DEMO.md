# DockTwin: 3-minute demo video script

**Live timings (measured Nov 3):** Demo mode ≈ 40 s until all fixes are verified · Build twin ≈ 19 s · SAM ≈ 2 s · vision ≈ 30 s · voice ≈ 3 s. Cut or narrate over the waits.

**Setup before recording:** deployed app (or `npm run dev`) with a real `MODEL_API_KEY` and `MOCK_META` unset. The model badges must show `muse-spark-1.3`, `sam-3.1`, and `muse-voice-transcribe-1.0` with no `MOCK` tag. Clear the audit log. Browser at 1440×900, microphone allowed.

> Source for the $68B figure: Otonomi, *2025 Supply Chain Disruption Market Report*. Show it on screen when you say the number, and cite it in the submission.

> DockTwin is an advisory prototype. Say so if asked: its thresholds are assumptions, it changes nothing in a real terminal, and it makes no claim of operational safety.

---

## 0:00 – 0:20 · The problem

**Screen:** title card → the Pacific Gate terminal in 3D (Demo mode loaded, idle).

**Voice-over:**
> "Shipping delays cost the industry an estimated $68 billion in 2025 (Otonomi, 2025 Supply Chain Disruption Market Report). For a terminal planner at LA/Long Beach, a delay often starts small: a box where the paperwork says *empty* and the scale says *24 tons*. A reefer warming up while the carrier says it's fine. A customs hold landing just as the lane goes down. Planners juggle these conflicts by hand. DockTwin tests the plan before the disruption hits."

## 0:20 – 1:30 · Voice and photo → 3D twin → stress test → approved decision

**0:20 · Speak it.** Click **🎙 Speak** and say:
> "Reefer box M-S-C-U 7154023 at Lane 3, plug at 4 degrees, customs hold possible, free time running out."

Show the transcript appear. Point at the badge: *muse-voice-transcribe-1.0*. The transcript nails the spoken container code first try: transcription is biased toward terminal vocabulary (box codes, lanes, reefer terms).

**0:30 · Photo.** Open **Photo → Twin** and click the *Box stack* sample. SAM 3.1 masks appear on about 33 containers in ~2 s (badge *sam-3.1*). Muse Spark vision then reads a dozen real container codes in ~30 s; start it before you speak, or cut.
> "SAM 3.1 segments the yard; Muse Spark reads what's in each box. Those detections seed the twin."

**0:40 · Demo mode.** Click **▶ Demo mode**. The 100-box terminal appears and the stress test runs.
> "Here's a full terminal: 100 boxes, four lanes, three cranes. Muse Spark wrote the rules. Now our agent attacks them: seeded scenarios plus adversarial ones Muse Spark invents. A deterministic engine runs every one."

Let the **Perfect storm** replay play. Boxes light up by final decision level, including any level raised by the safety policy.

**0:55 · Bugs, fixed and proven.** Scroll to **Behavior bugs**:
> "It found real bugs. Two rules fight over the gate route, so a heavy box declared *empty* goes to the fast lane. And the rules trust the carrier over the sensor, so they do nothing for a box 3.5 degrees warm. The engine's safety floor still flags that box for a person, but the rules should catch it."

Point at a fix diff and the green **VERIFIED** badge:
> "Muse Spark proposes each fix as a rule diff. The engine doesn't take its word for it: it replays every scenario on the patched twin. Bug gone, nothing new broken: verified."

Point at the **expectation unmet** card ("oracle written by the stress agent"):
> "Muse Spark doesn't just invent scenarios. It states what *must* happen, and the engine checks it. Here it insisted a 7-degree-warm reefer gets inspected, whatever the carrier claims."

Click **Approve & apply fix** on the gate-route conflict; the stress test re-runs and redrafts the remaining fixes. Then apply the reefer fix; the stress test re-runs clean.

**1:10 · Decision with human approval.** Pick scenario **S3 Reefer creeping warm**, scrub to *t=40*. Open the decision card for MSCU7154023:
> "For each box, the gentlest action that still works. Here: *inspect*. The sensor outranks the carrier: trust 0.90 versus 0.30 once they contradict. The evidence score is 0.73, and the estimate is about fifteen hundred dollars, most of it assumed spoilage risk on $85,000 of cargo. The safety policy is active, so a person has to sign off. DockTwin recommends; people decide. The policy can't be switched off by a rule, and the override menu won't go below it."

**Pause the replay (❚❚) first**, because explanations belong to the tick you're on. Open the evidence to show which reading and setpoint triggered the policy. Then click **Explain (Muse Spark)**, then **Approve inspect**. Show the new audit-log entry.

**Technical depth (one line, ~5 s):** with `SAFETY-CUSTOMS` / `SAFETY-REEFER-TEMP` visible on the decision card, say:
> "466 tests, a deterministic engine, and safety floors that don't depend on model output."

## 1:30 – 2:15 · Ordinary Tuesday: same engine, different world

**Screen:** switch to **Ordinary Tuesday · creator mode**, choose *Automatic sliding door*, **Build twin**, **Stress-test twin**.
> "The same maker works on an ordinary Tuesday for game studios and robotics teams. Describe an automatic door: motion sensor, safety beam, motor."

Replay **C1 Everything at once, then let go one by one** and scrub to *t=20* (motion stops, beam still blocked): the door panel slides open and shut.
> "The test agent finds the classic bug: someone stands still in the doorway, and two rules fight forever. The door chatters. It also finds that losing motor power hands control to nobody. Fixes are proposed, then proven by simulation. Same engine, a different template. Swap the door for a robot gripper and it works the same way."

## 2:15 – 3:00 · How it works, Meta models, impact

**Screen:** README architecture diagram (Mermaid) → audit log → badges.
> "The design rule: models plan, the engine decides. Muse Spark turns language and photos into a structured twin, invents attacks, proposes fixes, and explains decisions, always through JSON-schema-constrained output with automatic repair. SAM 3.1 turns photos into twin objects. Muse Voice Transcribe takes spoken input. A deterministic, seeded engine makes every recommendation, so seeded results are reproducible and covered by unit and golden tests. A person reviews every consequential action, and each one lands in a hash-chained audit log."

> "DockTwin suggests to terminal planners which boxes to slow, reroute, inspect, or release before a disruption becomes a delay, and shows them exactly why. The benefit lands beyond the planner's desk: truckers spend less time idling at dead lanes, shippers get cargo that arrives unspoiled and on schedule, and port neighborhoods breathe less diesel from queues that never form. Built with Meta models in nine days. Thank you."

**End card:** repo URL (github.com/nduy1234/DockTwin), live URL (docktwin.vercel.app), "Built with Muse Spark · SAM 3.1 · Muse Voice Transcribe", "Everything shown was built Oct 27 – Nov 4, 2026."

**Production notes:** use the 3D replay wherever the script says replay (don't cut away to static panels); burn captions into the final export.

---

### Verified numbers

Rechecked on 2026-11-04 in mock mode on Day's latest main with the safety policy merged in. A live Muse Spark run on 2026-11-03 gave the same numbers. With root-cause grouping, mock mode shows two bug cards (the gate-route conflict and the reefer gap); live runs can add cards from the stress agent's own scenarios and oracles.

| Moment | Level | Evidence score | Estimate | Approval |
| --- | --- | --- | --- | --- |
| S3 at t=40, before fixes | inspect | 0.72 | $1,456 | Required: high impact, rules under-reacted, `SAFETY-REEFER-TEMP` |
| S3 at t=40, after both fixes | inspect | 0.73 | $1,456 | Required: high impact, `SAFETY-REEFER-TEMP` |
| S2 at t=30, customs hold | hold | 0.95 | $1,664 | Required: high impact, cost, `SAFETY-CUSTOMS`. No override menu; **Hand to supervisor** stays available |

The evidence score is not a calibrated probability, and dollar figures rest on planning assumptions.

### Fallbacks while recording
- If a live model call is slow, keep talking over the "drafting a fix…" state; fixes stream in independently.
- If voice fails, type the sentence (the build path is identical) and show voice in a separate take.
- Never record with `MOCK_META=1`: mock calls are visibly labeled `MOCK`.
