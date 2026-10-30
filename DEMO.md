# DockTwin: 3-minute demo video script

**Setup before recording:** deployed app (or `npm run dev`) with a real `MODEL_API_KEY` and `MOCK_META` unset. The model badges must show `muse-spark-1.3`, `sam-3.1`, and `muse-voice-transcribe-1.0` with no `MOCK` tag. Clear the audit log. Browser at 1440×900, microphone allowed.

> ⚠️ **Cite the $68B figure** on screen and in the submission (source + year) before recording. Only claim numbers you can source.

---

## 0:00 – 0:20 · The problem

**Screen:** title card → the Pacific Gate terminal in 3D (Demo mode loaded, idle).

**Voice-over:**
> "Shipping delays cost the industry an estimated $68 billion in 2025 [cite]. Most of that starts at the terminal: a box where the paperwork says *empty* and the scale says *24 tons*. A reefer warming up while the carrier says it's fine. A customs hold landing just as the lane goes down. Planners juggle these conflicts by hand. DockTwin tests the plan before the disruption hits."

## 0:20 – 1:30 · Voice and photo → 3D twin → stress test → approved decision

**0:20 · Speak it.** Click **🎙 Speak** and say:
> "Reefer box M-S-C-U 7154023 at Lane 3, plug at 4 degrees, customs hold possible, free time running out."

Show the transcript appear. Point at the badge: *muse-voice-transcribe-1.0*.

**0:30 · Photo.** Open **Photo → Twin**, click the *Terminal gate* sample. SAM 3.1 masks appear over containers and cranes; badge *sam-3.1*. Then the Muse Spark vision line: "codes read by Muse Spark vision".
> "SAM 3.1 segments the yard; Muse Spark reads what's in each box. Those detections seed the twin."

**0:40 · Demo mode.** Click **▶ Demo mode**. The 100-box terminal appears and the stress test runs.
> "Here's a full terminal: 100 boxes, four lanes, three cranes. Muse Spark wrote the rules. Now our agent attacks them: seeded scenarios plus adversarial ones Muse Spark invents. A deterministic engine runs every one."

Let the **Perfect storm** replay play; boxes light up by action level.

**0:55 · Bugs, fixed and proven.** Scroll to **Behavior bugs**:
> "It found two real bugs. Two rules fight over the gate route, so a heavy box declared *empty* goes to the fast lane. And the reefer rule trusts the carrier over the sensor, so a box 3.5 degrees warm gets no action at all."

Point at a fix diff and the green **VERIFIED** badge:
> "Muse Spark proposes each fix as a rule diff. The engine doesn't take its word for it: it replays every scenario on the patched twin. Bug gone, nothing new broken: verified."

Click **Approve & apply fix** → stress re-runs clean.

**1:10 · Decision with human approval.** Pick scenario **S3 Reefer creeping warm**, scrub to *t=40*. Open the decision card for MSCU7154023:
> "For each box, the gentlest action that still works. Here: *inspect*. The sensor outranks the carrier: trust 0.90 versus 0.30 once they contradict. Confidence 0.72, estimated cost of inspecting about fifteen hundred dollars, most of it spoilage risk on $85,000 of cargo. Because the rules under-reacted, a human has to sign off."

Click **Explain (Muse Spark)**, then **Approve inspect**. Show the new audit-log entry.

## 1:30 – 2:15 · Ordinary Tuesday: same engine, different world

**Screen:** switch to **Ordinary Tuesday · creator mode**, choose *Automatic sliding door*, **Build twin**, **Stress-test twin**.
> "The same maker works on an ordinary Tuesday for game studios and robotics teams. Describe an automatic door: motion sensor, safety beam, motor."

Replay **C1 Everything at once, then let go one by one** and scrub to *t=20* (motion stops, beam still blocked): the door panel slides open and shut.
> "The test agent finds the classic bug: someone stands still in the doorway, and two rules fight forever. The door chatters. It also finds that losing motor power hands control to nobody. Fixes are proposed, then proven by simulation. Same engine, a different template. Swap the door for a robot gripper and it works the same way."

## 2:15 – 3:00 · How it works, Meta models, impact

**Screen:** README architecture diagram (Mermaid) → audit log → badges.
> "The design rule: models plan, the engine decides. Muse Spark turns language and photos into a structured twin, invents attacks, proposes fixes, and explains decisions, always through JSON-schema-constrained output with automatic repair. SAM 3.1 turns photos into twin objects. Muse Voice Transcribe takes spoken input. A deterministic, seeded engine makes every call, so every result is reproducible and covered by unit and golden tests. Every action, by a model or a person, lands in a tamper-evident audit log."

> "DockTwin tells terminal planners which boxes to slow, reroute, inspect, or release before a disruption becomes a delay, and shows them exactly why. Built with Meta models in nine days. Thank you."

**End card:** repo URL, "Built with Muse Spark · SAM 3.1 · Muse Voice Transcribe".

---

### Fallbacks while recording
- If a live model call is slow, keep talking over the "drafting a fix…" state; fixes stream in independently.
- If voice fails, type the sentence (the build path is identical) and show voice in a separate take.
- Never record with `MOCK_META=1`: mock calls are visibly labeled `MOCK`.
