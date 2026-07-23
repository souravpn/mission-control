// escalation.js — human-in-the-loop review queue
// Pauses workflow when verifiers can't converge.
// Returns a Promise that resolves when human makes a decision.

// Active escalation slot — one at a time
let _resolve = null;

// Show the escalation modal and wait for human decision.
// Returns: { verdict: 'confirmed'|'refuted', note: string }
export function requestHumanReview({ agentName, finding, passNum, verifierSummary }) {
  return new Promise((resolve) => {
    _resolve = resolve;
    _showModal({ agentName, finding, passNum, verifierSummary });
  });
}

function _showModal({ agentName, finding, passNum, verifierSummary }) {
  const modal = document.getElementById('escalation-modal');
  if (!modal) {
    console.error('[escalation] modal element not found in DOM');
    return;
  }
  console.log('[escalation] showing modal for:', finding.title);

  document.getElementById('esc-agent-name').textContent    = agentName;
  document.getElementById('esc-pass-num').textContent      = `Pass ${passNum} — could not converge`;
  document.getElementById('esc-finding-sev').textContent   = finding.sev?.toUpperCase() || '—';
  document.getElementById('esc-finding-sev').className     = `finding-sev ${finding.sev}`;
  document.getElementById('esc-finding-title').textContent = finding.title;
  document.getElementById('esc-finding-desc').textContent  = finding.desc;
  document.getElementById('esc-verifier-summary').textContent = verifierSummary || 'Verifiers could not reach consensus.';
  document.getElementById('esc-note').value = '';

  modal.classList.add('open');
}

function _closeModal() {
  const modal = document.getElementById('escalation-modal');
  if (modal) modal.classList.remove('open');
}

// Called by HTML buttons
window.humanConfirm = () => {
  const note = document.getElementById('esc-note').value.trim();
  _closeModal();
  _resolve?.({ verdict: 'confirmed', note });
  _resolve = null;
};

window.humanRefute = () => {
  const note = document.getElementById('esc-note').value.trim();
  _closeModal();
  _resolve?.({ verdict: 'refuted', note });
  _resolve = null;
};

window.humanAmend = () => {
  const note = document.getElementById('esc-note').value.trim();
  if (!note) {
    document.getElementById('esc-note').focus();
    document.getElementById('esc-note').placeholder = 'Required: describe the amendment';
    return;
  }
  _closeModal();
  _resolve?.({ verdict: 'amended', note });
  _resolve = null;
};
