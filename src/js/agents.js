// agents.js
import { WORKFLOW } from './workflow-config.js';
import { claudeJSON, estimateCost } from './api.js';
import { recordAgentCall, recordVerifierCall, recordSynthesisCall } from './trace.js';
import { requestHumanReview } from './escalation.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Agent system prompts ──────────────────────────────────────

const SCAN_SYSTEM = `\
You are a focused analysis agent. You have been assigned a single subtask.
Perform it thoroughly and return ONLY a JSON object — no prose, no markdown.

Schema:
{
  "agentName": "your assigned name",
  "summary": "one sentence summary of what you found",
  "findings": [
    {
      "sev": "critical|high|medium|low|info",
      "title": "short finding title (max 80 chars)",
      "desc": "detailed explanation with specifics (file names, line numbers, versions if known)",
      "confidence": 0.0
    }
  ]
}

confidence is a float 0.0–1.0:
  1.0 = direct evidence, no ambiguity
  0.8 = strong inference from clear signals
  0.6 = reasonable inference, some uncertainty
  0.4 = possible but speculative
  0.2 = mentioned for completeness, low confidence

If you find nothing concerning, return an empty findings array.
Be specific. Vague findings are useless. Include concrete details.`;

const VERIFIER_SYSTEM = `\
You are an adversarial reviewer. Your job is to challenge findings from a scan agent.
For each finding, try to disprove it. Look for false positives, overstatements, missing context.

Return ONLY a JSON object — no prose, no markdown.

Schema:
{
  "verdicts": [
    {
      "index": 0,
      "verdict": "confirmed|amended|refuted|contested",
      "reason": "why you reached this verdict",
      "confidenceAdjustment": 0.0,
      "newDesc": "revised description if amended (omit if confirmed or refuted)",
      "newSev": "revised severity if amended (omit otherwise)"
    }
  ],
  "contestedIndexes": [],
  "summary": "one sentence summary of verification outcome"
}

verdict meanings:
- confirmed:  finding is solid, confidence += confidenceAdjustment (positive)
- amended:    finding real but needs correction, set confidenceAdjustment
- refuted:    false positive, confidence → 0, drop from report
- contested:  insufficient evidence to decide — triggers escalation

confidenceAdjustment: float -1.0 to +1.0
  confirmed finding with strong corroboration: +0.1 to +0.2
  confirmed but with caveats: 0.0
  amended finding (severity reduced): -0.1 to -0.2
  finding that barely survived refutation: -0.3

Be genuinely adversarial. Weak findings should be refuted or contested.`;

const SYNTHESIS_SYSTEM = `\
You are a synthesis agent. You receive verified findings from multiple analysis agents.
Your job: produce TWO things in one JSON object.

1. A SHORT BRIEF — editorial judgment. Not a summary of everything. 
   Pick the 3-5 findings that most change what the user should do or think.
   Rewrite them as crisp, actionable insights — not raw finding descriptions.
   Include ONE clear recommendation and ONE watch-out.
   
2. COUNTS only — severity breakdown for display. Do not reformat the full findings list.

The brief must be domain-aware. Use synthesisApproach to guide prioritization:
  risk_report:            prioritize by exploitability × impact × time-sensitivity
  weighted_recommendation: prioritize by decision impact — what most changes behavior
  diagnosis_differential: prioritize by urgency and safety-net value
  decision_matrix:        prioritize by irreversibility and financial exposure

Return ONLY raw JSON. No markdown fences. No explanation.

Schema:
{
  "headline": "one punchy sentence — the verdict on the whole situation",
  "brief": [
    {
      "sev": "critical|high|medium|low|info",
      "title": "rewritten as an insight, not a raw finding title",
      "action": "what to do about this, specifically",
      "confidence": 0.85,
      "sourceAgents": ["Agent Name"]
    }
  ],
  "recommendation": "the single most important next action",
  "watchOut": "the one risk that could invalidate everything else",
  "bySeverity": { "critical": 0, "high": 0, "medium": 0, "low": 0 },
  "totalFindings": 0,
  "synthesisApproach": "which approach was used"
}

brief must have 3-5 items. Never more. Never fewer unless there are fewer than 3 findings total.
These are the findings that most change what the user does — not necessarily the highest severity.`;

export async function runSynthesisLive(findings, apiKey, plan, onCostUpdate, onTokensUpdate, userFeedback = null, previousBrief = null, synthNum = 0) {
  const model           = plan?.synthesisModel || 'claude-opus-4-8';
  const synthesisMaxTokens = 8000;
  const approach        = plan?.synthesisApproach || 'weighted_recommendation';
  const isReSynth       = !!userFeedback;

  const tileId   = synthNum === 0 ? 'synthesis-tile'   : `synthesis-tile-${synthNum}`;
  const badgeId  = synthNum === 0 ? 'synthesis-badge'  : `synthesis-badge-${synthNum}`;
  const streamId = synthNum === 0 ? 'synthesis-stream' : `synthesis-stream-${synthNum}`;

  setTileState(tileId, badgeId, 'running', isReSynth ? 'Re-synthesizing' : 'Synthesizing');
  const stream = document.getElementById(streamId);
  if (stream) stream.innerHTML = '';

  const hints = isReSynth
    ? ['→ re-reading findings through new lens...', '→ applying your feedback...', '→ generating new brief...', '✓ ready']
    : ['→ reading all verified findings...', '→ identifying what actually matters...', '→ writing brief...', '✓ ready'];
  const hintInterval = showHintLoop(stream, hints);

  // Send all findings — no truncation. The brief schema constrains output size, not input.

  // ── Prompt caching ──────────────────────────────────────
  // System prompt + findings JSON are identical across re-synthesis calls.
  // Cache them so re-synths only pay full price for the small feedback delta.
  const cachedSystem = [
    { type: 'text', text: SYNTHESIS_SYSTEM, cache_control: { type: 'ephemeral' } }
  ];

  const findingsBlock = {
    type: 'text',
    text: `Verified findings (${findings.length} total):\n${JSON.stringify(findings, null, 2)}\n\nSynthesis approach: ${approach}`,
    cache_control: { type: 'ephemeral' }, // cache the expensive findings JSON
  };

  const feedbackBlock = userFeedback ? {
    type: 'text',
    text: `\n\nPrevious brief shown to user:\n${JSON.stringify(previousBrief, null, 2)}\n\nUser feedback: "${userFeedback}"\n\nProduce a new brief that directly addresses this feedback. Do not repeat what already satisfied them.`,
  } : null;

  const userBlocks = feedbackBlock ? [findingsBlock, feedbackBlock] : [findingsBlock];

  const startTime = Date.now();
  try {
    const { data, usage, stopReason } = await claudeJSON({
      apiKey, model,
      system: cachedSystem,
      user: userBlocks,
      maxTokens: synthesisMaxTokens,
    });

    clearInterval(hintInterval);
    if (stream) stream.innerHTML = '';
    appendStreamLine(stream, `✓ ${data.headline || 'Brief ready'}`, 'var(--phase-report)');
    appendStreamLine(stream, `✓ ${data.brief?.length || 0} key insights · ${findings.length} findings analysed`, 'var(--text-secondary)');

    // Show cache hit — re-synths should show the actual cache_read for this call
    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheCreated = usage.cache_creation_input_tokens || 0;
    if (cacheRead > 0) {
      appendStreamLine(stream, `⚡ ${cacheRead.toLocaleString()} tokens from cache (90% cheaper)`, 'var(--phase-verify)');
    } else if (cacheCreated > 0) {
      appendStreamLine(stream, `⚡ Cache written: ${cacheCreated.toLocaleString()} tokens (next call will be cheaper)`, 'var(--text-muted)');
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const cost = estimateCost(model, usage.input_tokens, usage.output_tokens);
    onCostUpdate(cost);
    onTokensUpdate?.(usage.input_tokens, usage.output_tokens);
    renderFooter(tileId, usage, elapsed, stopReason);

    recordSynthesisCall({
      model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
      cost, durationMs: parseFloat(elapsed) * 1000,
      stopReason, findings: data.brief, summary: data.headline,
    });
    setTileState(tileId, badgeId, 'verified', isReSynth ? 'Re-done' : 'Complete');

    return data;

  } catch (err) {
    clearInterval(hintInterval);
    if (stream) stream.innerHTML = '';
    appendStreamLine(stream, `✗ Synthesis error: ${err.message}`, 'var(--sev-critical)');
    setTileState(tileId, badgeId, 'error', 'Error');
    return null;
  }
}

// ── Planner tile ──────────────────────────────────────────────

export function buildPlannerTile() {
  const body = document.getElementById('agents-body');
  body.innerHTML = '';
  body.appendChild(makeDivider('◎ Planner', 'var(--phase-plan)', 'rgba(124,58,237,0.2)'));

  const tile = makeTile({
    id: 'planner-tile',
    fullWidth: true,
    color: 'var(--phase-plan)', colorRgb: '124,58,237',
    name: '◎ Orchestrator — Plan &amp; Script',
    model: WORKFLOW.planner.model,
    modelColor: 'var(--phase-plan)',
    badgeId: 'planner-badge', badgeText: 'Planning',
    streamId: 'planner-stream', streamHint: 'Writing orchestration script...',
  });
  body.appendChild(tile);
}

export function activatePlannerTile() {
  setTileState('planner-tile', 'planner-badge', 'running', 'Thinking');
}

export function completePlannerTile() {
  setTileState('planner-tile', 'planner-badge', 'verified', 'Done');
}

// ── Scan tiles ────────────────────────────────────────────────

export function buildAgentTiles(agentDefs) {
  const body = document.getElementById('agents-body');
  body.appendChild(makeDivider('⬡ Scan Agents', 'var(--phase-scan)', 'rgba(14,165,233,0.2)'));
  agentDefs.forEach(def => body.appendChild(makeScanTile(def)));
}

function makeScanTile(def) {
  return makeTile({
    id: `agent-tile-${def.id}`,
    color: def.color, colorRgb: def.colorRgb,
    name: def.name, model: def.model,
    badgeId: `agent-badge-${def.id}`, badgeText: 'Idle',
    streamId: `agent-stream-${def.id}`, streamHint: def.description || def.focus,
    findingsId: `agent-findings-${def.id}`,
  });
}

// Simulated scan agent — uses streamHint lines from config/plan
export async function runAgentSimulated(agentDef) {
  const stream = document.getElementById(`agent-stream-${agentDef.id}`);
  setTileState(`agent-tile-${agentDef.id}`, `agent-badge-${agentDef.id}`, 'running', 'Scanning');
  stream.innerHTML = '';

  const lines = agentDef.stream || agentDef.streamHint || ['→ scanning...', '✓ done'];
  for (const line of lines) {
    await typeStreamLine(stream, line);
    await sleep(160 + Math.random() * 260);
  }

  // Show finding chips from config
  const findings = (agentDef.findings || []).map(f => ({ ...f, agent: agentDef.name }));
  showFindingChips(`agent-findings-${agentDef.id}`, findings);

  setTileState(`agent-tile-${agentDef.id}`, `agent-badge-${agentDef.id}`, 'idle', 'Awaiting verify');
  return findings;
}

// Live scan agent — real API call
export async function runAgentLive(agentDef, apiKey, onCostUpdate, onTokensUpdate) {
  const tileId  = `agent-tile-${agentDef.id}`;
  const badgeId = `agent-badge-${agentDef.id}`;
  const stream  = document.getElementById(`agent-stream-${agentDef.id}`);
  setTileState(tileId, badgeId, 'running', 'Thinking');
  stream.innerHTML = '';

  const hints = agentDef.streamHint || agentDef.stream || ['→ analysing...'];
  const hintInterval = showHintLoop(stream, hints);
  const startTime = Date.now();

  try {
    const { data, usage, stopReason, retried } = await claudeJSON({
      apiKey,
      model: agentDef.model,
      system: SCAN_SYSTEM,
      user: `Your assigned task: ${agentDef.task}\n\nAgent name: ${agentDef.name}`,
      maxTokens: agentDef.maxTokens || 2000,
      onRetry: () => {
        clearInterval(hintInterval);
        stream.innerHTML = '';
        setTileState(tileId, badgeId, 'running', 'Retrying');
        showHintLoop(stream, ['→ retrying with more tokens...', '→ escalating to opus...']);
        renderFooter(tileId, null, null, 'retrying', 0);
      },
    });

    clearInterval(hintInterval);
    stream.innerHTML = '';

    const findings = (data.findings || []).map(f => ({
      ...f,
      agent: agentDef.name,
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.7,
    }));
    const summaryEl = document.createElement('div');
    summaryEl.style.color = 'var(--text-secondary)';
    summaryEl.style.marginBottom = '4px';
    summaryEl.textContent = `✓ ${data.summary || `${findings.length} findings`}`;
    if (retried) {
      summaryEl.textContent += ' (retried)';
      summaryEl.style.color = 'var(--phase-verify)';
    }
    stream.appendChild(summaryEl);

    showFindingChips(`agent-findings-${agentDef.id}`, findings);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const cost = estimateCost(agentDef.model, usage.input_tokens, usage.output_tokens);
    onCostUpdate(cost);
    onTokensUpdate?.(usage.input_tokens, usage.output_tokens);
    renderFooter(tileId, usage, elapsed, stopReason);

    // Record to trace
    recordAgentCall({
      agentId: agentDef.id, agentName: agentDef.name,
      model: agentDef.model, task: agentDef.task,
      inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
      cost, durationMs: parseFloat(elapsed) * 1000,
      stopReason, findings, summary: data.summary,
    });

    setTileState(tileId, badgeId, 'idle', 'Awaiting verify');
    return findings;

  } catch (err) {
    clearInterval(hintInterval);
    stream.innerHTML = '';
    appendStreamLine(stream, `✗ ${err.message}`, 'var(--sev-critical)');
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    renderFooter(tileId, null, elapsed, 'error');
    setTileState(tileId, badgeId, 'error', 'Error');
    return [];
  }
}

// ── Verifier tiles ────────────────────────────────────────────

export function buildVerifierTiles(agentDefs) {
  const body = document.getElementById('agents-body');
  body.appendChild(makeDivider('⚡ Adversarial Verifiers', 'var(--phase-verify)', 'rgba(245,158,11,0.2)'));
  agentDefs.forEach(def => body.appendChild(makeVerifierTile(def.id, 1, 'claude-sonnet-4-6')));
}

function makeVerifierTile(agentId, passNum, model) {
  const isEscalated = passNum > 1;
  const color = isEscalated ? 'var(--sev-critical)' : 'var(--phase-verify)';
  const agentName = getAgentName(agentId);
  const label = isEscalated ? `⚡ ${agentName} · Pass ${passNum}` : `⚡ ${agentName}`;

  return makeTile({
    id: `verifier-tile-${agentId}-p${passNum}`,
    color, colorRgb: isEscalated ? '239,68,68' : '245,158,11',
    name: label, nameSize: '10px', model,
    modelColor: color,
    badgeId: `verifier-badge-${agentId}-p${passNum}`, badgeText: 'Queued',
    streamId: `verifier-stream-${agentId}-p${passNum}`, streamHint: 'Waiting for scan...',
    extraClass: 'verifier-tile',
  });
}

// Simulated verifier — uses WORKFLOW.verifiers config
export async function runVerifierSimulated(agentDef, rawFindings, onVerifiedFinding) {
  const passes = WORKFLOW.verifiers[agentDef.id];
  await _runVerifierPasses(agentDef.id, passes, rawFindings, onVerifiedFinding, false);
}

// Live verifier — real adversarial API call
export async function runVerifierLive(agentDef, rawFindings, apiKey, plan, onVerifiedFinding, onCostUpdate, onTokensUpdate) {
  const vs = plan?.verificationStrategy || {};
  const verifierModel    = vs.model           || 'claude-sonnet-4-6';
  const escalationModel  = vs.escalationModel || 'claude-opus-4-8';
  const maxPasses        = vs.maxPasses        || 2;
  const passesRequired   = vs.passesRequired   || 1;
  const humanOnContested = vs.humanReviewOnContested || false;

  await _runVerifierPasses(agentDef.id, null, rawFindings, onVerifiedFinding, true, {
    apiKey, verifierModel, escalationModel, agentDef,
    onCostUpdate, onTokensUpdate, plan,
    maxPasses, passesRequired, humanOnContested,
  });
}

async function _runVerifierPasses(agentId, simPasses, rawFindings, onVerifiedFinding, isLive, liveOpts) {
  let passNum = 1;
  let pendingFindings = rawFindings;

  while (true) {
    const tileId   = `verifier-tile-${agentId}-p${passNum}`;
    const streamId = `verifier-stream-${agentId}-p${passNum}`;
    const badgeId  = `verifier-badge-${agentId}-p${passNum}`;

    // Spawn new tile for pass 2+
    if (passNum > 1) {
      const body = document.getElementById('agents-body');
      const prevTile = document.getElementById(`verifier-tile-${agentId}-p${passNum - 1}`);
      const model = isLive ? liveOpts.escalationModel : (simPasses?.[passNum - 1]?.model || 'claude-opus-4-8');
      const newTile = makeVerifierTile(agentId, passNum, model);
      prevTile ? prevTile.after(newTile) : body.appendChild(newTile);
      await sleep(300);
    }

    const tile   = document.getElementById(tileId);
    const stream = document.getElementById(streamId);
    const badge  = document.getElementById(badgeId);

    tile.className = `agent-tile verifying verifier-tile`;
    badge.className = 'agent-badge verifying';
    badge.textContent = passNum > 1 ? `Pass ${passNum}` : 'Challenging';
    stream.innerHTML = '';

    let contestedFindings = [];

    if (isLive) {
      const model = passNum === 1 ? liveOpts.verifierModel : liveOpts.escalationModel;
      const vs = liveOpts.plan?.verificationStrategy || {};
      const verifierMaxTokens = passNum > 1 ? (vs.escalationMaxTokens || 3000) : (vs.maxTokens || 2000);

      const hintInterval = showHintLoop(stream, [
        '→ reviewing findings...',
        '→ checking for false positives...',
        '→ validating severity...',
        passNum > 1 ? '→ escalated review in progress...' : '→ adversarial challenge...',
      ]);

      try {
        const startTime = Date.now();
        const { data, usage, stopReason } = await claudeJSON({
          apiKey: liveOpts.apiKey,
          model,
          system: VERIFIER_SYSTEM,
          user: `Agent: ${liveOpts.agentDef.name}\nTask: ${liveOpts.agentDef.task || liveOpts.agentDef.focus}\n\nFindings to challenge:\n${JSON.stringify(pendingFindings, null, 2)}`,
          maxTokens: verifierMaxTokens,
          onRetry: () => {
            setTileState(tileId, badgeId, 'running', 'Retrying');
            renderFooter(tileId, null, null, 'retrying', 0);
          },
        });

        clearInterval(hintInterval);
        stream.innerHTML = '';

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const cost = estimateCost(model, usage.input_tokens, usage.output_tokens);
        liveOpts.onCostUpdate(cost);
        liveOpts.onTokensUpdate?.(usage.input_tokens, usage.output_tokens);
        renderFooter(tileId, usage, elapsed, stopReason);

        recordVerifierCall({
          agentId, agentName: liveOpts.agentDef.name, model, passNum,
          inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
          cost, durationMs: parseFloat(elapsed) * 1000,
          stopReason, verdicts: data.verdicts,
          summary: data.summary, contestedIndexes: data.contestedIndexes,
        });

        // Process verdicts with confidence adjustment
        for (const v of (data.verdicts || [])) {
          const finding = pendingFindings[v.index];
          if (!finding) continue;
          const baseConf = finding.confidence ?? 0.7;
          const adj = v.confidenceAdjustment ?? 0;

          if (v.verdict === 'confirmed') {
            const finalConf = Math.min(1.0, baseConf + adj);
            appendStreamLine(stream, `✓ confirmed [${Math.round(finalConf*100)}%]: ${finding.title.slice(0,45)}`, 'var(--phase-report)');
            onVerifiedFinding({ ...finding, verified: true, confidence: finalConf, verifierReason: v.reason });
          } else if (v.verdict === 'amended') {
            const finalConf = Math.max(0.1, baseConf + adj);
            appendStreamLine(stream, `~ amended [${Math.round(finalConf*100)}%]: ${finding.title.slice(0,45)}`, 'var(--phase-verify)');
            onVerifiedFinding({ ...finding, verified: true, amended: true, confidence: finalConf,
              verifierReason: v.reason, desc: v.newDesc || finding.desc, sev: v.newSev || finding.sev });
          } else if (v.verdict === 'refuted') {
            appendStreamLine(stream, `✗ refuted: ${finding.title.slice(0,45)}`, 'var(--sev-critical)');
            tile.classList.add('contested');
            setTimeout(() => tile.classList.remove('contested'), 1500);
          } else if (v.verdict === 'contested') {
            appendStreamLine(stream, `⚠ contested: ${finding.title.slice(0,40)}`, 'var(--phase-verify)');
            contestedFindings.push({ ...finding, _verifierReason: v.reason });
          }
        }

        appendStreamLine(stream, `✓ ${data.summary || 'verification complete'}`, 'var(--phase-report)');

        for (const i of (data.contestedIndexes || [])) {
          const f = pendingFindings[i];
          if (f && !contestedFindings.find(c => c.title === f.title)) contestedFindings.push(f);
        }

      } catch (err) {
        clearInterval(hintInterval);
        stream.innerHTML = '';
        appendStreamLine(stream, `✗ Verifier error: ${err.message}`, 'var(--sev-critical)');
        pendingFindings.forEach(f => onVerifiedFinding({ ...f, verified: false, confidence: 0.3 }));
        contestedFindings = [];
      }

      // human escalation now handled in shared block above

    } else {
      // Simulated verifier
      const pass = simPasses?.[passNum - 1];
      if (!pass) break;

      for (const line of pass.lines) {
        const isContest = line.startsWith('✗') || line.includes('CONTEST');
        const isWarn    = line.startsWith('⚠');
        const isOk      = line.startsWith('✓');
        const color = isContest ? 'var(--sev-critical)'
                    : isWarn    ? 'var(--phase-verify)'
                    : isOk      ? 'var(--phase-report)'
                    :             'var(--text-secondary)';
        await typeStreamLine(stream, line, color);
        if (isContest) tile.classList.add('contested');
        await sleep(isContest || isWarn ? 420 : 120 + Math.random() * 200);
      }
      tile.classList.remove('contested');

      for (const v of (pass.verdicts || [])) {
        const finding = pendingFindings[v.index];
        if (!finding) continue;
        const baseConf = finding.confidence ?? 0.7;
        if (v.verdict === 'confirmed') onVerifiedFinding({ ...finding, verified: true, confidence: Math.min(1.0, baseConf + 0.1) });
        else if (v.verdict === 'amended') onVerifiedFinding({ ...finding, verified: true, amended: true, desc: v.newDesc, confidence: Math.max(0.1, baseConf - 0.1) });
        else if (v.verdict === 'contested') contestedFindings.push({ ...finding, _verifierReason: v.reason || 'Insufficient evidence to confirm or refute.' });
        else if (v.verdict === 'refuted') appendStreamLine(stream, `✗ refuted: ${finding.title.slice(0,45)}`, 'var(--sev-critical)');
      }
    }

    // ── Human escalation applies in both sim and live ──
    const _maxPasses  = isLive ? (liveOpts.maxPasses || 2) : (simPasses?.length || 1);
    const ranOut      = passNum >= _maxPasses;
    const humanOn     = isLive ? (liveOpts.humanOnContested || false) : (WORKFLOW.humanReviewOnContested || false);
    const hasMorePasses = isLive
      ? contestedFindings.length > 0 && passNum < _maxPasses
      : (simPasses?.[passNum] != null);

    if (contestedFindings.length > 0 && (humanOn || ranOut) && !hasMorePasses) {
      for (const finding of contestedFindings) {
        appendStreamLine(stream, `⏸ escalating to human: ${finding.title.slice(0,40)}`, 'var(--phase-verify)');
        setTileState(tileId, badgeId, 'verifying', '⏸ Human review');
        const decision = await requestHumanReview({
          agentName: isLive ? liveOpts.agentDef.name : (WORKFLOW.agents[agentId]?.name || `Agent ${agentId}`),
          finding, passNum,
          verifierSummary: finding._verifierReason || 'Verifiers exhausted all passes without consensus.',
        });
        if (decision.verdict === 'confirmed') {
          onVerifiedFinding({ ...finding, verified: true, confidence: 0.75, humanReviewed: true, humanNote: decision.note });
          appendStreamLine(stream, `✓ human confirmed`, 'var(--phase-report)');
        } else if (decision.verdict === 'amended') {
          onVerifiedFinding({ ...finding, verified: true, amended: true, confidence: 0.8, humanReviewed: true, desc: decision.note || finding.desc });
          appendStreamLine(stream, `~ human amended`, 'var(--phase-verify)');
        } else {
          appendStreamLine(stream, `✗ human refuted`, 'var(--sev-critical)');
        }
      }
      contestedFindings = [];
      // Mark tile done after all human reviews complete
      tile.className = 'agent-tile verified verifier-tile';
      badge.className = 'agent-badge verified';
      badge.textContent = '👤 Done';
    } // end human escalation block

    if (hasMorePasses && contestedFindings.length > 0) {
      badge.textContent = 'Escalated';
      badge.className = 'agent-badge error';
      pendingFindings = contestedFindings;
      passNum++;
      await sleep(300);
    } else {
      tile.className = 'agent-tile verified verifier-tile';
      badge.className = 'agent-badge verified';
      badge.textContent = 'Done';
      break;
    }
  }
}

// ── Synthesis ─────────────────────────────────────────────────

export function buildSynthesisTile(synthNum = 0) {
  const body = document.getElementById('agents-body');

  // Only add divider before first synthesis tile
  if (synthNum === 0) {
    body.appendChild(makeDivider('◈ Synthesis', 'var(--phase-report)', 'rgba(16,185,129,0.2)'));
  }

  const tileId   = synthNum === 0 ? 'synthesis-tile' : `synthesis-tile-${synthNum}`;
  const badgeId  = synthNum === 0 ? 'synthesis-badge' : `synthesis-badge-${synthNum}`;
  const streamId = synthNum === 0 ? 'synthesis-stream' : `synthesis-stream-${synthNum}`;
  const label    = synthNum === 0 ? '◈ Report Synthesis' : `◈ Re-Synthesis ${synthNum}`;

  const tile = makeTile({
    id: tileId, fullWidth: true,
    color: 'var(--phase-report)', colorRgb: '16,185,129',
    name: label, model: synthNum === 0 ? WORKFLOW.synthesis.model : 'claude-opus-4-8',
    modelColor: 'var(--phase-report)',
    badgeId, badgeText: 'Queued',
    streamId, streamHint: synthNum === 0 ? 'Awaiting verified findings...' : 'Re-reading findings...',
  });
  body.appendChild(tile);
  return { tileId, badgeId, streamId };
}

export async function runSynthesisAgent(simulated) {
  setTileState('synthesis-tile', 'synthesis-badge', 'running', 'Synthesizing');
  const stream = document.getElementById('synthesis-stream');
  stream.innerHTML = '';

  for (const line of WORKFLOW.synthesis.stream) {
    await typeStreamLine(stream, line, line.startsWith('✓') ? 'var(--phase-report)' : 'var(--text-secondary)');
    await sleep(130 + Math.random() * 160);
  }

  setTileState('synthesis-tile', 'synthesis-badge', 'verified', 'Complete');
}

// ── Shared helpers ────────────────────────────────────────────

function makeTile({ id, fullWidth, color, colorRgb, name, nameSize, model, modelColor,
                    badgeId, badgeText, streamId, streamHint, findingsId, extraClass }) {
  const tile = document.createElement('div');
  tile.className = `agent-tile idle${extraClass ? ' ' + extraClass : ''}`;
  tile.id = id;
  if (fullWidth) tile.style.cssText = 'grid-column: 1 / -1;';
  tile.style.setProperty('--tile-color', color);
  tile.style.setProperty('--tile-color-rgb', colorRgb);
  tile.innerHTML = `
    <div class="agent-tile-header">
      <div class="agent-color-bar" style="background:${color};"></div>
      <div class="agent-name" ${nameSize ? `style="font-size:${nameSize};"` : ''}>${name}</div>
      <div class="agent-model-tag" style="color:${modelColor || 'var(--text-muted)'};">${model}</div>
      <div class="agent-badge idle" id="${badgeId}">${badgeText}</div>
    </div>
    <div class="agent-stream" id="${streamId}">
      <span style="color:var(--text-muted);font-size:9px;">${streamHint}</span>
    </div>
    ${findingsId ? `<div class="agent-findings" id="${findingsId}"></div>` : ''}
  `;
  return tile;
}

export function updateDividerStats(section, stats) {
  // section: 'planner' | 'scan' | 'verify' | 'synthesis'
  const dividers = document.querySelectorAll('.agents-divider');
  dividers.forEach(d => {
    const label = d.querySelector('span')?.textContent?.toLowerCase() || '';
    const matches =
      (section === 'planner'   && label.includes('planner')) ||
      (section === 'scan'      && label.includes('scan')) ||
      (section === 'verify'    && label.includes('verif')) ||
      (section === 'synthesis' && label.includes('synth'));
    if (matches) {
      let statsSpan = d.querySelectorAll('span')[1];
      if (!statsSpan) {
        statsSpan = document.createElement('span');
        statsSpan.style.cssText = `margin-left:auto;color:var(--text-secondary);font-size:9px;letter-spacing:0;text-transform:none;`;
        d.appendChild(statsSpan);
      }
      statsSpan.textContent = stats;
    }
  });
}

function makeDivider(label, color, borderColor, stats = null) {
  const el = document.createElement('div');
  el.className = 'agents-divider';
  el.style.cssText = `font-family:var(--font-mono);font-size:9px;color:${color};
    letter-spacing:1px;padding:8px 4px 4px;text-transform:uppercase;
    border-top:1px solid ${borderColor};margin-top:2px;
    display:flex;align-items:center;gap:6px;`;
  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  el.appendChild(labelSpan);
  if (stats) {
    const statsSpan = document.createElement('span');
    statsSpan.style.cssText = `margin-left:auto;color:var(--text-muted);font-size:9px;letter-spacing:0;text-transform:none;`;
    statsSpan.textContent = stats;
    el.appendChild(statsSpan);
  }
  return el;
}

export function setTileState(tileId, badgeId, state, badgeText) {
  const tile  = document.getElementById(tileId);
  const badge = document.getElementById(badgeId);
  if (!tile || !badge) return;
  tile.className = tile.className.replace(/\b(idle|running|verifying|verified|error)\b/g, '').trim() + ` ${state}`;
  badge.className = `agent-badge ${state}`;
  badge.textContent = badgeText;
}

function showFindingChips(findingsId, findings) {
  const el = document.getElementById(findingsId);
  if (!el) return;
  findings.forEach(f => {
    const chip = document.createElement('div');
    chip.className = `finding-chip ${f.sev}`;
    chip.textContent = f.sev.toUpperCase();
    el.appendChild(chip);
  });
}

// Shows hint lines cycling while waiting for API response
function showHintLoop(container, hints) {
  let i = 0;
  container.innerHTML = '';
  const line = document.createElement('div');
  line.style.color = 'var(--text-muted)';
  line.style.fontStyle = 'italic';
  container.appendChild(line);

  const spinner = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let s = 0;
  const interval = setInterval(() => {
    line.textContent = `${spinner[s++ % spinner.length]} ${hints[i % hints.length]}`;
    if (s % 10 === 0) i++;
  }, 100);
  return interval;
}

// agentDefs is set once scan agents are built — used for verifier labels
let _agentDefs = [];
export function setAgentDefsCache(defs) { _agentDefs = defs; }

function getAgentName(id) {
  return _agentDefs[id]?.name || WORKFLOW.agents[id]?.name || `Agent ${id}`;
}

function renderFooter(tileId, usage, elapsed, stopReason, attempt) {
  const tile = document.getElementById(tileId);
  if (!tile) return;

  // Remove any existing footer
  tile.querySelector('.agent-footer')?.remove();

  const footer = document.createElement('div');
  footer.className = 'agent-footer';

  if (usage) {
    footer.innerHTML = `
      <span class="agent-footer-stat">↑ ${(usage.input_tokens||0).toLocaleString()}</span>
      <span class="agent-footer-stat">↓ ${(usage.output_tokens||0).toLocaleString()}</span>
      ${elapsed ? `<span class="agent-footer-stat">⏱ ${elapsed}s</span>` : ''}
      <span class="stop-reason ${stopReason || 'end_turn'}">${stopReason || 'end_turn'}</span>
    `;
  } else if (stopReason === 'retrying') {
    footer.innerHTML = `<span class="stop-reason retrying">retrying…</span>`;
  } else if (stopReason === 'error') {
    footer.innerHTML = `${elapsed ? `<span class="agent-footer-stat">⏱ ${elapsed}s</span>` : ''}<span class="stop-reason error">error</span>`;
  }

  tile.appendChild(footer);
}

async function typeStreamLine(container, text, color = 'var(--text-secondary)') {
  const line = document.createElement('div');
  line.style.color = color;
  container.appendChild(line);
  for (const ch of text) {
    line.textContent += ch;
    await sleep(4 + Math.random() * 7);
  }
  container.scrollTop = container.scrollHeight;
}

function appendStreamLine(container, text, color = 'var(--text-secondary)') {
  const line = document.createElement('div');
  line.style.color = color;
  line.textContent = text;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}
