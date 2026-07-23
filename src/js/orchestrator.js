// orchestrator.js
import { claudeJSON, estimateCost } from './api.js';
import { WORKFLOW } from './workflow-config.js';

const SAMPLE_BY_EFFORT = { low: 20, medium: 40, high: 90 };

const PLANNER_MODEL = 'claude-opus-4-8';

// ── Planner system prompt ─────────────────────────────────────
// This is the most important prompt in Mission Control.
// It must return a strict JSON plan — no prose, no markdown prose,
// just the JSON object the JS runtime will execute.
const PLANNER_SYSTEM = `\
You are an orchestration planner for Mission Control, a multi-agent analysis system.

Read the user's task and return a JSON execution plan. Be concise — short task descriptions only.

Rules:
- Choose the number of agents that best fits the task. Typically 3–6.
  Fewer if simple/tightly scoped. More if genuinely independent parallel dimensions.
  Never pad to fill a number — every agent must have a distinct non-overlapping focus.
- agent.task: max 2 sentences. Self-contained. Include key specifics from user prompt.
- agent.streamHint: exactly 4 lines. First 3 start with "→", last starts with "✓".
- agent.maxTokens: 1000 (simple extraction) | 2000 (moderate analysis) | 3000 (deep reasoning).
- agent.model: claude-haiku-4-5 (pattern matching/extraction) | claude-sonnet-4-6 (reasoning/judgment).
  Never use claude-opus-4-8 for scan agents.

stakes assessment:
- "low"      → vacation, lifestyle, creative decisions. 1 verification pass, no escalation.
- "medium"   → career, product, business decisions. 1-2 passes, escalate critical findings.
- "high"     → financial, legal, security, infrastructure decisions. 2 passes mandatory, humanReviewOnContested MUST be true.
- "critical" → medical, patient safety, large irreversible financial exposure. 3 passes, humanReviewOnContested MUST be true.

verificationStrategy rules by stakes:
  low:      passesRequired:1, maxPasses:1, humanReviewOnContested:false, escalationTrigger:"none"
  medium:   passesRequired:1, maxPasses:2, humanReviewOnContested:false, escalationTrigger:"critical_only"
  high:     passesRequired:2, maxPasses:2, humanReviewOnContested:true,  escalationTrigger:"any_contested"
  critical: passesRequired:2, maxPasses:3, humanReviewOnContested:true,  escalationTrigger:"always_human"

Return ONLY raw JSON. No markdown fences. No explanation. No preamble.

Schema:
{
  "workflow": "3-4 word name",
  "rationale": "one sentence",
  "stakes": "low|medium|high|critical",
  "stakesReason": "one sentence explaining why this stakes level",
  "effort": "low|medium|high",
  "agents": [
    {
      "id": 0,
      "name": "Short Name",
      "model": "claude-haiku-4-5",
      "maxTokens": 2000,
      "focus": "one line",
      "task": "Max two sentences. Include specifics from user prompt.",
      "streamHint": ["→ doing x", "→ doing y", "→ doing z", "✓ complete"]
    }
  ],
  "verificationStrategy": {
    "model": "claude-sonnet-4-6",
    "maxTokens": 2000,
    "passesRequired": 1,
    "escalationTrigger": "any_contested",
    "escalationModel": "claude-opus-4-8",
    "escalationMaxTokens": 3000,
    "maxPasses": 2,
    "humanReviewOnContested": false
  },
  "synthesisModel": "claude-opus-4-8",
  "synthesisMaxTokens": 3000,
  "synthesisApproach": "risk_report|weighted_recommendation|decision_matrix|diagnosis_differential"
}`;

// ── Run planner ───────────────────────────────────────────────
export async function runOrchestratorPhase(apiKey, prompt, effort, onCostUpdate, simulated, attachment) {
  if (simulated) return runOrchestratorSimulated(effort, onCostUpdate);

  const consoleEl = document.getElementById('orchestrator-console');
  consoleEl.innerHTML = '';
  appendConsoleLine(consoleEl, `// Mission Control — planning phase`, 'oc-comment');
  appendConsoleLine(consoleEl, `// model: ${PLANNER_MODEL} · effort: ${effort}`, 'oc-comment');
  appendConsoleLine(consoleEl, `// prompt: "${prompt.slice(0, 60)}${prompt.length > 60 ? '…' : ''}"`, 'oc-comment');
  if (attachment) {
    appendConsoleLine(consoleEl, `// attachment: ${attachment.name} (${attachment.summary})`, 'oc-comment');
  }
  appendConsoleLine(consoleEl, '', '');

  // Import here to avoid circular deps — attachment module is UI-only
  const { buildUserContent } = await import('./attachment.js');
  const userPrompt = `Task: ${prompt}\nEffort level: ${effort} (${SAMPLE_BY_EFFORT[effort]}% sampling depth)${attachment ? `\nAttached file: ${attachment.name}` : ''}`;
  const userContent = buildUserContent(userPrompt, attachment);

  const { data: plan, usage } = await claudeJSON({
    apiKey,
    model: PLANNER_MODEL,
    system: PLANNER_SYSTEM,
    user: userContent,
    maxTokens: 4000,
  });

  const cost = estimateCost(PLANNER_MODEL, usage.input_tokens, usage.output_tokens);
  onCostUpdate(cost, usage);

  // Render the plan as a JS-style script in the console
  renderPlanAsScript(consoleEl, plan, effort);

  // Complete the planner tile in the agents bar
  const plannerStream = document.getElementById('planner-stream');
  if (plannerStream) {
    plannerStream.innerHTML = '';
    const l1 = document.createElement('div');
    l1.style.color = 'var(--phase-report)';
    l1.textContent = `✓ ${plan.workflow} — ${plan.agents.length} agents planned`;
    plannerStream.appendChild(l1);
    const l2 = document.createElement('div');
    l2.style.color = 'var(--text-muted)';
    l2.textContent = plan.rationale;
    plannerStream.appendChild(l2);
  }

  return plan;
}

function renderPlanAsScript(consoleEl, plan, effort) {
  const vs = plan.verificationStrategy || {};
  const lines = [
    `// Workflow: ${plan.workflow}`,
    `// Rationale: ${plan.rationale}`,
    `// Stakes: ${plan.stakes?.toUpperCase() || 'MEDIUM'} — ${plan.stakesReason || ''}`,
    `// Effort: ${effort}`,
    ``,
    `const AGENTS = [`,
    ...plan.agents.map((a, i) =>
      `  { id:${a.id}, name:"${a.name}", model:"${a.model}", maxTokens:${a.maxTokens||2000} }${i < plan.agents.length - 1 ? ',' : ''}`
    ),
    `];`,
    ``,
    `// Verification strategy`,
    `const VERIFY = {`,
    `  model: "${vs.model || 'claude-sonnet-4-6'}",`,
    `  passesRequired: ${vs.passesRequired || 1},`,
    `  maxPasses: ${vs.maxPasses || 2},`,
    `  escalationTrigger: "${vs.escalationTrigger || 'any_contested'}",`,
    `  humanReview: ${vs.humanReviewOnContested || false},`,
    `};`,
    ``,
    `// Fan-out — run all agents concurrently`,
    `const results = await Promise.allSettled(`,
    `  AGENTS.map(agent => runAgent(agent))`,
    `);`,
    ``,
    `// Adversarial verification (${vs.passesRequired || 1} pass${vs.passesRequired > 1 ? 'es' : ''} required)`,
    `const verified = await verifyFindings(results, VERIFY);`,
    ``,
    `// Synthesis (${plan.synthesisModel || 'claude-opus-4-8'} · ${plan.synthesisApproach || 'report'})`,
    `return buildReport(verified);`,
  ];

  for (const line of lines) {
    appendConsoleLine(consoleEl, line, lineClass(line));
  }
}

function appendConsoleLine(container, text, cls) {
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text;
  container.appendChild(span);
  container.appendChild(document.createTextNode('\n'));
}

function lineClass(line) {
  if (line.trimStart().startsWith('//'))                        return 'oc-comment';
  if (/^\s*(const|let|var|await|return|async)/.test(line))     return 'oc-keyword';
  if (/runAgent|verifyFindings|buildReport|Promise/.test(line)) return 'oc-fn';
  return '';
}

// ── Simulated planner (uses WORKFLOW config) ──────────────────
async function runOrchestratorSimulated(effort, onCostUpdate) {
  const consoleEl = document.getElementById('orchestrator-console');
  consoleEl.innerHTML = '';
  const script = WORKFLOW.planner.scriptTemplate(effort, SAMPLE_BY_EFFORT[effort]);
  for (const line of script.split('\n')) {
    await typeLine(line, consoleEl);
    await sleep(18 + Math.random() * 28);
  }
  onCostUpdate(0.008); // simulated cost
  return null; // signals: use WORKFLOW config for agents
}

async function typeLine(line, container) {
  const span = document.createElement('span');
  span.className = lineClass(line);
  container.appendChild(span);
  container.appendChild(document.createTextNode('\n'));
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  container.appendChild(cursor);
  for (const ch of line) {
    cursor.before(document.createTextNode(ch));
    await sleep(7 + Math.random() * 14);
  }
  cursor.remove();
}

export function getAgentDefs(plan) {
  // Live mode: build from real plan
  if (plan) {
    const COLORS = [
      { color:'var(--agent-0)', colorRgb:'14,165,233'   },
      { color:'var(--agent-1)', colorRgb:'167,139,250'  },
      { color:'var(--agent-2)', colorRgb:'244,114,182'  },
      { color:'var(--agent-3)', colorRgb:'52,211,153'   },
      { color:'var(--phase-verify)', colorRgb:'245,158,11' },
      { color:'var(--phase-report)', colorRgb:'16,185,129' },
      { color:'#60a5fa',        colorRgb:'96,165,250'   },
      { color:'#f87171',        colorRgb:'248,113,113'  },
    ];
    return plan.agents.map((a, i) => ({
      ...a,
      ...COLORS[i % COLORS.length],
      description: a.focus,
      stream: a.streamHint || ['→ working...', '✓ done'],
      findings: [], // will be filled by real API response
    }));
  }
  // Sim mode: use WORKFLOW config
  return WORKFLOW.agents.map(a => ({ ...a }));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
