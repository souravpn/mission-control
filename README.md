# Mission Control

A dynamic multi-agent workflow visualizer built on the Claude API.

Watch an Opus 4.8 orchestrator plan a task, write a JS orchestration script, fan out parallel subagents, run adversarial verifiers with multi-pass escalation, and synthesize a final report — all in real time.

---

## What it demonstrates

- **Orchestrator pattern** — one Opus 4.8 call writes the entire workflow as a JS script, then steps aside
- **Parallel fan-out** — `Promise.allSettled()` runs N scan agents simultaneously, each with a minimal context window
- **Adversarial verification** — one verifier per scan agent challenges findings; contested findings spawn a pass-2 card with a stronger model
- **Tiered model usage** — Haiku for leaf tasks, Sonnet for verification, Opus for planning and escalations
- **Cost separation** — intermediate results live in JS variables (RAM), not in any model's context window

---

## Getting started

```bash
git clone https://github.com/your-username/mission-control.git
cd mission-control
python3 -m http.server 8080
# open http://localhost:8080
```

> Must be served over HTTP — ES modules don't load from `file://` URLs.

---

## Project structure

```
mission-control/
├── index.html                  # App shell, help modal
├── README.md
└── src/
    ├── css/
    │   ├── variables.css       # Design tokens
    │   ├── layout.css          # 4-zone Mission Control grid
    │   └── components.css      # Agent tiles, modal, report cards
    └── js/
        ├── workflow-config.js  # ← swap this to change scenarios
        ├── main.js             # Entry point, workflow orchestration
        ├── orchestrator.js     # Planner phase, reads from config
        ├── agents.js           # All agent tiles — planner/scan/verify/synthesis
        ├── report.js           # Final report renderer
        ├── sessions.js         # Session CRUD + export
        ├── state.js            # Central app state
        └── ui.js               # Status, phases, progress, toasts
```

---

## Swapping scenarios

**Everything data-specific lives in one file: `src/js/workflow-config.js`.**

To build a new workflow:

1. Copy `workflow-config.js`
2. Replace `agents[]` with your agent definitions (name, model, stream lines, findings)
3. Replace `verifiers[]` with your adversarial challenge scripts
4. Update `planner.scriptTemplate` to reflect the new plan
5. Update `samples[]` for the help modal

The entire Mission Control UI — planner tile, scan grid, verifier cards, pass-2 escalation, synthesis agent, phase pipeline — works unchanged.

### Example: Content moderation workflow

```js
agents: [
  { id:0, name:'Toxicity',      model:'claude-haiku-4-5',  ... },
  { id:1, name:'Legal Risk',    model:'claude-sonnet-4-6', ... },
  { id:2, name:'Brand Safety',  model:'claude-haiku-4-5',  ... },
  { id:3, name:'Fact Check',    model:'claude-sonnet-4-6', ... },
],
```

---

## Modes

| Mode | Description |
|---|---|
| **Simulated** | Uses hardcoded stream data from `workflow-config.js`. No API key needed. Free. |
| **Live** | Real Claude API calls per agent. Requires `sk-ant-...` key in sidebar. ~$0.05–0.20/run. |

---

## Cost model (live mode)

| Agent | Model | Approx. cost/run |
|---|---|---|
| Orchestrator | claude-opus-4-8 | ~$0.01 |
| Scan agents ×4 | claude-haiku-4-5 | ~$0.002 each |
| Verifiers ×4 | claude-sonnet-4-6 | ~$0.005 each |
| Escalations (if triggered) | claude-opus-4-8 | ~$0.01 each |
| Synthesis | claude-opus-4-8 | ~$0.01 |

A full medium-effort run costs roughly **$0.05–0.15**.

---

## Architecture diagram

```
User prompt
    │
    ▼
Orchestrator (Opus 4.8)
    │  writes JS orchestration script
    ▼
JS Runtime
    │  Promise.allSettled()
    ├──► Scan Agent A (Haiku)  ─┐
    ├──► Scan Agent B (Haiku)   │ raw findings
    ├──► Scan Agent C (Sonnet)  │ in JS variables
    └──► Scan Agent D (Haiku)  ─┘
                                │
    ┌───────────────────────────┘
    │  one verifier per agent
    ├──► Verifier A (Sonnet) → confirmed
    ├──► Verifier B (Sonnet) → amended
    ├──► Verifier C (Sonnet) → contested ──► Pass 2 (Opus)
    └──► Verifier D (Sonnet) → contested ──► Pass 2 (Opus)
                                │
    ┌───────────────────────────┘
    ▼
Synthesis Agent (Opus 4.8)
    │
    ▼
Final Report
```

---

## Browser support

Any modern browser supporting ES modules + Streams API:
Chrome/Edge 89+, Firefox 89+, Safari 15+

---

## License

MIT
