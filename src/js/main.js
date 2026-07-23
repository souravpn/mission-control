// main.js
import { state, loadSessions } from './state.js';
import { setStatus, setPhase, startProgress, setProgress,
         completeProgress, resetProgress, updateCost,
         toast, setAgentCount, setReportCount,
         startTimer, stopTimer, resetTimer, updateTokens, resetTokens } from './ui.js';
import { runOrchestratorPhase, getAgentDefs } from './orchestrator.js';
import { buildPlannerTile, activatePlannerTile, completePlannerTile,
         buildAgentTiles, runAgentSimulated, runAgentLive,
         buildVerifierTiles, runVerifierSimulated, runVerifierLive,
         buildSynthesisTile, runSynthesisAgent, runSynthesisLive,
         setAgentDefsCache, updateDividerStats, setTileState } from './agents.js';
import { renderReport, buildMarkdownReport, setReSynthHandler } from './report.js';
import { saveSession, renderSessionList, clearAllSessions } from './sessions.js';
import { WORKFLOW } from './workflow-config.js';
import { getAttachment, clearAttachment, ingestFile, buildUserContent } from './attachment.js';
import { initResize } from './resize.js';
import { initTrace, recordPlannerCall, finaliseTrace, exportTrace } from './trace.js';
import './escalation.js'; // registers window.humanConfirm/Refute/Amend

// ── Globals ──
window.clearSessions = clearAllSessions;
window.exportReport  = exportReport;
window.exportTrace   = exportTrace;
window.loadSession   = loadSession;
window.openHelp      = openHelp;
window.closeHelp     = closeHelp;
window.copyConsole   = copyConsole;

// ── Pause / Stop ──
window.pauseWorkflow = () => {
  if (!state.running) return;
  state.paused = !state.paused;
  const btn = document.getElementById('btn-pause');
  if (state.paused) {
    btn.classList.add('active');
    btn.title = 'Resume workflow';
    btn.textContent = '▶';
    setStatus('Paused — click ▶ to resume', 'verify');
    toast('Workflow paused — current agents will finish their call then wait', '');
  } else {
    btn.classList.remove('active');
    btn.title = 'Pause workflow';
    btn.textContent = '⏸';
    setStatus('Resuming...', 'active');
    toast('Workflow resumed', 'success');
  }
};

window.stopWorkflow = () => {
  if (!state.running) return;
  if (!confirm('Stop the workflow? Current API calls will finish but no new ones will start.')) return;
  state.stopped = true;
  state.paused  = false;
  document.getElementById('btn-pause').disabled = true;
  document.getElementById('btn-stop').disabled  = true;
  setStatus('Stopping...', '');
  toast('Workflow stopping — current calls will complete', 'error');
};

// Resolves when unpaused, or rejects if stopped
async function checkPaused() {
  if (state.stopped) throw new Error('Workflow stopped by user');
  while (state.paused) {
    await sleep(200);
    if (state.stopped) throw new Error('Workflow stopped by user');
  }
}

// ── File attachment handlers ──
window.handleFileSelect = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await ingestFile(file);
    toast(`Attached: ${file.name}`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
  e.target.value = ''; // reset so same file can be reselected
};

window.handleFileDrop = async (e) => {
  e.preventDefault();
  document.getElementById('attach-area').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  try {
    await ingestFile(file);
    toast(`Attached: ${file.name}`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.removeAttachment = () => {
  clearAttachment();
  toast('Attachment removed');
};

// ── Init UI from config ──
document.getElementById('prompt-input').placeholder = WORKFLOW.inputPlaceholder;
document.getElementById('run-btn').textContent = `▶ ${WORKFLOW.runLabel}`;
document.title = 'Mission Control';

// ── Running cost + token accumulator ──
let totalCost = 0;
const phaseStats = { tokensIn: 0, tokensOut: 0, cost: 0, start: 0 };

function startPhaseStats() {
  phaseStats.tokensIn = 0; phaseStats.tokensOut = 0; phaseStats.cost = 0;
  phaseStats.start = Date.now();
}

function formatPhaseStats() {
  const t = ((Date.now() - phaseStats.start) / 1000).toFixed(1);
  return `↑${phaseStats.tokensIn.toLocaleString()} ↓${phaseStats.tokensOut.toLocaleString()} ⏱${t}s $${phaseStats.cost.toFixed(3)}`;
}

function addCost(delta, section = null) {
  totalCost += delta;
  phaseStats.cost += delta;
  updateCost(totalCost);
}

function addTokens(input, output) {
  phaseStats.tokensIn  += (input  || 0);
  phaseStats.tokensOut += (output || 0);
  updateTokens(input, output);
}

// ── Effort ──
window.setEffort = (e) => {
  state.effort = e;
  document.querySelectorAll('.effort-pill').forEach(p =>
    p.classList.toggle('active', p.dataset.effort === e));
  document.getElementById('effort-desc').textContent = WORKFLOW.effortDesc[e];
};
document.getElementById('effort-desc').textContent = WORKFLOW.effortDesc['medium'];

window.toggleSim = () => {
  state.simulated = !state.simulated;
  document.getElementById('sim-toggle').classList.toggle('on', state.simulated);
  toast(state.simulated ? 'Simulated mode on' : 'Live API mode on');
};

window.toggleAutosave = () => {
  state.autosave = !state.autosave;
  document.getElementById('autosave-toggle').classList.toggle('on', state.autosave);
};

// ── Reset ──
window.resetAudit = () => {
  if (state.running) return;
  document.getElementById('orchestrator-console').innerHTML = '';
  document.getElementById('agents-body').innerHTML = '';
  document.getElementById('report-body').innerHTML = emptyReport();
  document.getElementById('report-count').textContent = '';
  document.getElementById('agent-count').textContent = '0 / 0';
  setStatus('Idle', ''); setPhase(null); resetProgress();
  totalCost = 0; updateCost(0); resetTimer(); resetTokens();
  clearAttachment();
  document.getElementById('btn-pause').disabled = true;
  document.getElementById('btn-stop').disabled  = true;
};

// ── Copy console ──
function copyConsole() {
  const text = document.getElementById('orchestrator-console').innerText;
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard', 'success'));
}

// ── Help modal ──
function openHelp() { document.getElementById('help-modal').classList.add('open'); }
function closeHelp() { document.getElementById('help-modal').classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHelp(); });

// ── Main workflow ────────────────────────────────────────────
window.runAudit = async () => {
  if (state.running) return;

  const prompt = document.getElementById('prompt-input').value.trim();
  const apiKey = document.getElementById('api-key').value.trim();

  if (!prompt) { toast('Enter a prompt to begin', 'error'); return; }
  if (!state.simulated && !apiKey) {
    toast('Enter your API key for live mode', 'error'); return;
  }

  state.running = true;
  state.paused  = false;
  state.stopped = false;
  state.findings = [];
  totalCost = 0;
  updateCost(0);
  resetTokens();
  resetTimer();
  startTimer();
  document.getElementById('run-btn').disabled    = true;
  document.getElementById('btn-pause').disabled  = false;
  document.getElementById('btn-stop').disabled   = false;
  document.getElementById('btn-pause').textContent = '⏸';
  document.getElementById('btn-pause').classList.remove('active');
  document.getElementById('report-body').innerHTML = emptyReport();
  setReportCount(0);
  document.getElementById('orchestrator-console').innerHTML = '';

  const attachment = getAttachment();
  initTrace(prompt, state.effort, attachment);
  const session = {
    id: Date.now(), prompt,
    effort: state.effort,
    timestamp: new Date().toISOString(),
    findings: [], workflow: WORKFLOW.name,
    attachmentName: attachment?.name || null,
  };
  state.currentSession = session;

  try {
    // ── Phase 1: Plan ──────────────────────────────────────
    setPhase('plan');
    setStatus('Orchestrator planning...', 'plan');
    startProgress();
    buildPlannerTile();
    activatePlannerTile();
    startPhaseStats();

    const plan = await runOrchestratorPhase(
      apiKey, prompt, state.effort, (cost, usage) => {
        addCost(cost);
        if (usage) {
          addTokens(usage.input_tokens, usage.output_tokens);
          recordPlannerCall({ model: 'claude-opus-4-8',
            inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
            cost, plan: null }); // plan filled after
        }
      }, state.simulated, attachment
    );
    completePlannerTile();
    updateDividerStats('planner', formatPhaseStats());
    await sleep(300);
    await checkPaused();

    // ── Phase 2: Scan ──────────────────────────────────────
    setPhase('scan');
    setStatus('Subagents scanning...', 'scan');
    setProgress(28);
    startPhaseStats();

    const agentDefs = getAgentDefs(plan);
    buildAgentTiles(agentDefs);
    setAgentDefsCache(agentDefs);
    setAgentCount(0, agentDefs.length);

    let scanDone = 0;
    const rawFindingsByAgent = await Promise.all(
      agentDefs.map((def, i) =>
        sleep(i * 180).then(async () => {
          const findings = state.simulated
            ? await runAgentSimulated(def)
            : await runAgentLive(def, apiKey, addCost, addTokens);
          scanDone++;
          setAgentCount(scanDone, agentDefs.length);
          return { def, findings };
        })
      )
    );
    updateDividerStats('scan', formatPhaseStats());
    setProgress(55);
    await sleep(200);
    await checkPaused();

    // ── Phase 3: Verify ────────────────────────────────────
    setPhase('verify');
    setStatus('Adversarial verification...', 'verify');
    startPhaseStats();
    buildVerifierTiles(agentDefs);
    buildSynthesisTile();

    await Promise.all(
      rawFindingsByAgent.map(({ def, findings }, i) =>
        sleep(i * 150).then(() =>
          state.simulated
            ? runVerifierSimulated(def, findings, f => state.findings.push(f))
            : runVerifierLive(def, findings, apiKey, plan, f => state.findings.push(f), addCost, addTokens)
        )
      )
    );

    // Mark scan agent tiles as verified now that their verifiers are done
    rawFindingsByAgent.forEach(({ def }) => {
      setTileState(`agent-tile-${def.id}`, `agent-badge-${def.id}`, 'verified', 'Done');
    });
    updateDividerStats('verify', formatPhaseStats());
    setProgress(82);
    await sleep(200);
    await checkPaused();

    // ── Synthesis ──────────────────────────────────────────
    startPhaseStats();
    let finalFindings = state.findings;
    let brief = null;

    if (state.simulated) {
      await runSynthesisAgent(true);
      renderReport(null, finalFindings);
    } else {
      const synthResult = await runSynthesisLive(state.findings, apiKey, plan, addCost, addTokens);
      brief = synthResult;
      finalFindings = state.findings;
      updateDividerStats('synthesis', formatPhaseStats());
      renderReport(brief, finalFindings);
    }

    setReportCount(finalFindings.length);
    await sleep(200);

    // Wire the re-synthesis handler
    let synthNum = 0;
    setReSynthHandler(async (feedback, prevBrief, findings) => {
      synthNum++;
      const bar = document.getElementById('report-feedback-bar');
      if (bar) bar.style.opacity = '0.5';
      setStatus('Re-synthesizing...', 'plan');

      // Build a new tile for this re-synthesis round
      buildSynthesisTile(synthNum);

      const reSynthResult = await runSynthesisLive(
        findings, apiKey, plan, addCost, addTokens,
        feedback, prevBrief, synthNum
      );
      if (reSynthResult) {
        renderReport(reSynthResult, findings);
        setReportCount(findings.length);
        updateDividerStats('synthesis', formatPhaseStats());
      }
      setStatus('Mission Control complete', 'active');
    });

    // ── Phase 4: Report ────────────────────────────────────
    setPhase('report');
    setStatus('Mission Control complete', 'active');
    stopTimer();
    document.getElementById('btn-pause').disabled = true;
    document.getElementById('btn-stop').disabled  = true;
    completeProgress();

    const trace = finaliseTrace();
    session.findings = finalFindings;
    session.brief    = brief;
    session.trace    = trace;
    if (state.autosave) { saveSession(session); renderSessionList(); }
    toast(`Complete — ${finalFindings.length} findings · $${totalCost.toFixed(3)}`, 'success');

  } catch (err) {
    stopTimer();
    document.getElementById('btn-pause').disabled = true;
    document.getElementById('btn-stop').disabled  = true;
    const userStopped = err.message === 'Workflow stopped by user';
    setStatus(userStopped ? 'Stopped' : 'Error', '');
    resetProgress();
    if (!userStopped) toast(err.message, 'error');
    else toast('Workflow stopped', '');
    console.error(err);
  }

  state.running = false;
  document.getElementById('run-btn').disabled = false;
};

// ── Load session ──
function loadSession(index) {
  const s = state.sessions[index];
  if (!s) return;
  state.currentSession = s;
  renderReport(s.brief || null, s.findings || []);
  setReportCount((s.findings || []).length);
  setPhase('report');
  setStatus('Session loaded', 'active');
  document.getElementById('agents-body').innerHTML =
    '<div style="padding:20px;color:var(--text-muted);font-size:10px;font-family:var(--font-mono);text-align:center;grid-column:1/-1;">Agent streams not persisted — run again to see live tiles</div>';
  document.getElementById('orchestrator-console').innerHTML =
    `<span class="oc-comment">// Session: ${new Date(s.timestamp).toLocaleString()}\n// Workflow: ${s.workflow || '—'} · Findings: ${(s.findings||[]).length}</span>`;
  renderSessionList();
  toast('Session loaded');
}

// ── Export ──
function exportReport() {
  if (!state.currentSession) { toast('No session to export', 'error'); return; }
  const md = buildMarkdownReport(state.currentSession);
  const a = document.createElement('a');
  a.href = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(md);
  a.download = `mission-control-${state.currentSession.id}.md`;
  a.click();
  toast('Report exported', 'success');
}

// ── Helpers ──
function emptyReport() {
  return '<div id="report-empty"><div class="report-empty-icon">◈</div><div style="font-size:11px;">Awaiting results</div></div>';
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Keyboard ──
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') window.runAudit();
});

// ── Boot ──
loadSessions();
renderSessionList();
initResize();

// Populate scenarios grid in help modal
const grid = document.getElementById('scenarios-grid');
if (grid) {
  WORKFLOW.samples.forEach(s => {
    const card = document.createElement('div');
    card.className = 'scenario-card';
    card.innerHTML = `<div class="scenario-icon">${s.icon}</div>
      <div class="scenario-title">${s.title}</div>
      <div class="scenario-desc">${s.desc}</div>`;
    grid.appendChild(card);
  });
}
