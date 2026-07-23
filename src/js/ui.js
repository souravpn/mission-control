// ui.js

export function setStatus(label, mode = '') {
  const _sd = document.getElementById('status-dot'); if(_sd) _sd.className = 'status-dot' + (mode ? ` ${mode}` : '');
  const _st = document.getElementById('status-text'); if(_st) _st.textContent = label;
}

export function setPhase(phase) {
  // phase: null | 'plan' | 'scan' | 'verify' | 'report'
  const steps = ['plan','scan','verify','report'];
  const idx = steps.indexOf(phase);
  steps.forEach((s, i) => {
    const el = document.getElementById(`phase-${s}`);
    if (!el) return;
    el.className = 'phase-step';
    if (i < idx)  el.classList.add('done');
    if (i === idx) el.classList.add('active', s);
  });
}

export function startProgress() {
  const b = document.getElementById('progress');
  b.className = 'progress-fill indeterminate';
  b.style.background = 'linear-gradient(90deg, var(--phase-plan), var(--phase-scan))';
}

export function setProgress(pct) {
  const b = document.getElementById('progress');
  b.className = 'progress-fill';
  b.style.width = pct + '%';
}

export function completeProgress() {
  const b = document.getElementById('progress');
  b.className = 'progress-fill';
  b.style.width = '100%';
  b.style.background = 'linear-gradient(90deg, var(--phase-verify), var(--phase-report))';
  setTimeout(() => { b.style.width = '0%'; }, 1200);
}

export function resetProgress() {
  const b = document.getElementById('progress');
  b.className = 'progress-fill';
  b.style.width = '0%';
}

export function updateCost(dollars) {
  const _cv = document.getElementById('cost-val'); if(_cv) _cv.textContent = dollars.toFixed(3);
}

export function toast(msg, type = '') {
  const c = document.getElementById('toast');
  const el = document.createElement('div');
  el.className = `toast-msg ${type}`.trim();
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function setAgentCount(done, total) {
  const el = document.getElementById('agent-count');
  if (el) el.textContent = `${done} / ${total}`;
}

export function setReportCount(n) {
  const _rc = document.getElementById('report-count'); if(_rc) _rc.textContent = n ? `${n} findings` : '';
}

// ── Topbar stats ──────────────────────────────────────────────
let _timerInterval = null;
let _timerStart = null;

export function startTimer() {
  _timerStart = Date.now();
  _timerInterval = setInterval(() => {
    const s = ((Date.now() - _timerStart) / 1000).toFixed(1);
    const el = document.getElementById('stat-time');
    if (el) el.textContent = s + 's';
  }, 100);
}

export function stopTimer() {
  if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
}

export function resetTimer() {
  stopTimer();
  const el = document.getElementById('stat-time');
  if (el) el.textContent = '0.0s';
}

export function updateTokens(inputDelta, outputDelta) {
  const inEl  = document.getElementById('stat-tokens-in');
  const outEl = document.getElementById('stat-tokens-out');
  if (!inEl || !outEl) return;
  const curIn  = parseInt(inEl.dataset.raw || '0') + inputDelta;
  const curOut = parseInt(outEl.dataset.raw || '0') + outputDelta;
  inEl.dataset.raw  = curIn;
  outEl.dataset.raw = curOut;
  inEl.textContent  = curIn.toLocaleString();
  outEl.textContent = curOut.toLocaleString();
}

export function resetTokens() {
  ['stat-tokens-in','stat-tokens-out'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.dataset.raw = '0'; el.textContent = '0'; }
  });
}
