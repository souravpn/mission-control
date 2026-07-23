// report.js — two-layer report: brief (default) + full findings (expandable)

const SEV_ORDER = ['critical','high','medium','low','info'];

// ── Main entry point ──────────────────────────────────────────
// brief: synthesis output ({ headline, brief[], recommendation, watchOut, bySeverity })
// findings: raw verified findings array (state.findings)
export function renderReport(brief, findings) {
  const body = document.getElementById('report-body');
  body.innerHTML = '';

  // If no brief (sim mode or synthesis failed), fall back to flat list
  if (!brief || !brief.brief) {
    renderFlatReport(body, findings);
    return;
  }

  renderBriefLayer(body, brief, findings);
}

// ── Brief layer (default view) ────────────────────────────────
function renderBriefLayer(body, brief, findings) {

  // Headline
  const headline = document.createElement('div');
  headline.className = 'report-headline';
  headline.textContent = brief.headline || 'Analysis complete';
  body.appendChild(headline);

  // Brief findings (3-5 cards)
  const briefList = document.createElement('div');
  briefList.className = 'report-brief-list';
  body.appendChild(briefList);

  (brief.brief || []).forEach((f, i) => {
    const card = document.createElement('div');
    card.className = `report-finding ${f.sev || 'info'}`;
    card.style.animationDelay = `${i * 80}ms`;
    const conf = f.confidence != null ? Math.round(f.confidence * 100) : null;
    const confColor = conf >= 80 ? 'var(--phase-report)' : conf >= 60 ? 'var(--phase-verify)' : 'var(--sev-critical)';
    card.innerHTML = `
      <div class="finding-header">
        <span class="finding-sev ${f.sev || 'info'}">${f.sev || 'info'}</span>
        ${conf != null ? `<span class="finding-confidence" style="color:${confColor};">${conf}%</span>` : ''}
        <span class="finding-agent">${(f.sourceAgents || []).join(', ')}</span>
      </div>
      <div class="finding-title">${f.title}</div>
      ${f.action ? `<div class="finding-action">→ ${f.action}</div>` : ''}
    `;
    briefList.appendChild(card);
  });

  // Recommendation + watch-out bar
  if (brief.recommendation || brief.watchOut) {
    const bar = document.createElement('div');
    bar.className = 'report-action-bar';
    bar.innerHTML = `
      ${brief.recommendation ? `
        <div class="report-action-item report-action-rec">
          <span class="report-action-label">▶ DO FIRST</span>
          <span class="report-action-text">${brief.recommendation}</span>
        </div>` : ''}
      ${brief.watchOut ? `
        <div class="report-action-item report-action-watch">
          <span class="report-action-label">⚠ WATCH OUT</span>
          <span class="report-action-text">${brief.watchOut}</span>
        </div>` : ''}
    `;
    body.appendChild(bar);
  }

  // Severity count bar
  const counts = brief.bySeverity || {};
  const total  = brief.totalFindings || findings.length;
  const countBar = document.createElement('div');
  countBar.className = 'report-count-bar';
  countBar.innerHTML = `
    <span class="rcount rcount-c">${counts.critical||0} critical</span>
    <span class="rcount rcount-h">${counts.high||0} high</span>
    <span class="rcount rcount-m">${counts.medium||0} medium</span>
    <span class="rcount rcount-l">${counts.low||0} low</span>
    <span class="rcount-total">${total} total findings</span>
  `;
  body.appendChild(countBar);

  // Expandable full findings drawer
  const drawer = document.createElement('div');
  drawer.className = 'report-drawer';
  const drawerToggle = document.createElement('button');
  drawerToggle.className = 'report-drawer-toggle';
  drawerToggle.innerHTML = `▼ Show all ${findings.length} findings`;
  drawerToggle.onclick = () => toggleDrawer(drawer, drawerToggle, findings);
  body.appendChild(drawerToggle);
  body.appendChild(drawer);

  // Re-synthesis feedback bar
  body.appendChild(buildFeedbackBar(brief, findings));
}

// ── Full findings drawer ──────────────────────────────────────
function toggleDrawer(drawer, toggle, findings) {
  if (drawer.dataset.open === 'true') {
    drawer.innerHTML = '';
    drawer.dataset.open = 'false';
    toggle.innerHTML = `▼ Show all ${findings.length} findings`;
    return;
  }

  drawer.dataset.open = 'true';
  toggle.innerHTML = `▲ Hide full findings`;

  const sorted = [...findings].sort((a,b) =>
    SEV_ORDER.indexOf(a.sev) - SEV_ORDER.indexOf(b.sev)
  );

  sorted.forEach((f, i) => {
    const card = document.createElement('div');
    card.className = `report-finding ${f.sev || 'info'} drawer-finding`;
    card.style.animationDelay = `${i * 40}ms`;
    const conf = f.confidence != null ? Math.round(f.confidence * 100) : null;
    const confColor = conf >= 80 ? 'var(--phase-report)' : conf >= 60 ? 'var(--phase-verify)' : 'var(--sev-critical)';
    card.innerHTML = `
      <div class="finding-header">
        <span class="finding-sev ${f.sev}">${f.sev}</span>
        ${conf != null ? `<span class="finding-confidence" style="color:${confColor};">${conf}%</span>` : ''}
        ${f.humanReviewed ? `<span class="finding-human-badge">👤 reviewed</span>` : ''}
        ${f.amended ? `<span class="finding-amended-badge">~ amended</span>` : ''}
        <span class="finding-agent">${f.agent || ''}</span>
      </div>
      <div class="finding-title">${f.title}</div>
      <div class="finding-desc">${f.desc}</div>
      ${f.verifierReason ? `<div class="finding-verifier-note">${f.verifierReason}</div>` : ''}
    `;
    drawer.appendChild(card);
  });
}

// ── Re-synthesis feedback bar ────────────────────────────────
function buildFeedbackBar(brief, findings) {
  const bar = document.createElement('div');
  bar.className = 'report-feedback-bar';
  bar.id = 'report-feedback-bar';
  bar.innerHTML = `
    <div class="feedback-prompt">Was this the angle you needed?</div>
    <div class="feedback-quick">
      <button class="feedback-btn" data-q="Different perspective">↺ Different angle</button>
      <button class="feedback-btn" data-q="Focus only on the most urgent actions">⚡ Just actions</button>
      <button class="feedback-btn" data-q="Explain like I'm unfamiliar with this domain, simpler language">◎ Simpler</button>
      <button class="feedback-btn" data-q="Go deeper on risks and what could go wrong">⚠ More risks</button>
    </div>
    <div class="feedback-custom">
      <input type="text" id="feedback-input" placeholder="Or ask anything... e.g. 'assume I only have 3 days'" />
      <button class="btn btn-sm feedback-submit" id="feedback-submit">→</button>
    </div>
    <div class="feedback-actions">
      <button class="effort-pill active" id="feedback-pretty">✦ Pretty</button>
      <button class="effort-pill" id="feedback-dismiss">✓ Done</button>
    </div>
  `;

  bar.querySelectorAll('.feedback-btn').forEach(btn => {
    btn.onclick = () => triggerReSynth(btn.dataset.q, brief, findings);
  });

  bar.querySelector('#feedback-submit').onclick = () => {
    const val = document.getElementById('feedback-input')?.value?.trim();
    if (val) triggerReSynth(val, brief, findings);
  };
  bar.querySelector('#feedback-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (val) triggerReSynth(val, brief, findings);
    }
  });

  bar.querySelector('#feedback-pretty').onclick = () => {
    renderPrettyBrief(brief, findings);
    const btn = document.getElementById('feedback-pretty');
    if (btn) { btn.textContent = '✦ Prettified'; btn.classList.add('active'); }
  };

  bar.querySelector('#feedback-dismiss').onclick = () => {
    bar.style.animation = 'slideOut 0.2s ease forwards';
    setTimeout(() => bar.remove(), 200);
  };

  return bar;
}

function renderPrettyBrief(brief, findings) {
  const body = document.getElementById('report-body');
  if (!body) return;
  const drawer = body.querySelector('.report-drawer');
  const toggle = body.querySelector('.report-drawer-toggle');
  const feedbackBar = body.querySelector('.report-feedback-bar');
  body.innerHTML = '';

  const headline = document.createElement('div');
  headline.className = 'report-headline';
  headline.textContent = brief.headline || 'Analysis complete';
  body.appendChild(headline);

  const list = document.createElement('div');
  list.className = 'report-brief-list';
  (brief.brief || []).forEach((f, i) => {
    const conf = f.confidence != null ? Math.round(f.confidence * 100) : null;
    const confColor = conf >= 80 ? 'var(--phase-report)' : conf >= 60 ? 'var(--phase-verify)' : 'var(--sev-critical)';
    const actionPoints = f.action ? f.action.split(/[;,]/).map(s => s.trim()).filter(Boolean) : [];
    const card = document.createElement('div');
    card.className = `report-finding ${f.sev || 'info'}`;
    card.style.animationDelay = `${i * 80}ms`;
    card.innerHTML = `
      <div class="finding-header">
        <span class="finding-sev ${f.sev || 'info'}">${f.sev || 'info'}</span>
        ${conf != null ? `<span class="finding-confidence" style="color:${confColor};">${conf}%</span>` : ''}
        <span class="finding-agent">${(f.sourceAgents || []).join(', ')}</span>
      </div>
      <div class="finding-title" style="font-size:13px;font-weight:600;margin-bottom:6px;">${f.title}</div>
      ${actionPoints.length > 1
        ? `<ul class="pretty-action-list">${actionPoints.map(p => `<li>${p}</li>`).join('')}</ul>`
        : f.action ? `<div class="finding-action">→ ${f.action}</div>` : ''}
    `;
    list.appendChild(card);
  });
  body.appendChild(list);

  if (brief.recommendation || brief.watchOut) {
    const actionBar = document.createElement('div');
    actionBar.className = 'report-action-bar';
    if (brief.recommendation) actionBar.innerHTML += `<div class="report-action-item report-action-rec"><div><div class="report-action-label" style="margin-bottom:4px;">▶ DO FIRST</div><div class="report-action-text" style="font-size:12px;font-weight:500;">${brief.recommendation}</div></div></div>`;
    if (brief.watchOut)      actionBar.innerHTML += `<div class="report-action-item report-action-watch"><div><div class="report-action-label" style="margin-bottom:4px;">⚠ WATCH OUT</div><div class="report-action-text" style="font-size:12px;">${brief.watchOut}</div></div></div>`;
    body.appendChild(actionBar);
  }

  const counts = brief.bySeverity || {};
  const countBar = document.createElement('div');
  countBar.className = 'report-count-bar';
  countBar.innerHTML = `<span class="rcount rcount-c">${counts.critical||0} critical</span><span class="rcount rcount-h">${counts.high||0} high</span><span class="rcount rcount-m">${counts.medium||0} medium</span><span class="rcount rcount-l">${counts.low||0} low</span><span class="rcount-total">${brief.totalFindings || findings.length} total</span>`;
  body.appendChild(countBar);

  if (toggle) body.appendChild(toggle);
  if (drawer) body.appendChild(drawer);
  if (feedbackBar) body.appendChild(feedbackBar);
}

// triggerReSynth is set by main.js so report.js doesn't need to import from main
export function setReSynthHandler(fn) {
  triggerReSynth = fn;
}
let triggerReSynth = (feedback, brief, findings) => {
  console.warn('Re-synth handler not set', feedback);
};

// ── Flat fallback (sim mode / no brief) ──────────────────────
function renderFlatReport(body, findings) {
  if (!findings?.length) {
    body.innerHTML = '<div id="report-empty"><div class="report-empty-icon">◈</div><div style="font-size:11px;">Awaiting results</div></div>';
    return;
  }

  const counts = { critical:0, high:0, medium:0, low:0 };
  findings.forEach(f => { if (counts[f.sev] !== undefined) counts[f.sev]++; });

  const summary = document.createElement('div');
  summary.className = 'report-summary';
  summary.innerHTML = `
    <div class="report-stat"><div class="report-stat-label">Critical</div><div class="report-stat-value critical">${counts.critical}</div></div>
    <div class="report-stat"><div class="report-stat-label">High</div><div class="report-stat-value high">${counts.high}</div></div>
    <div class="report-stat"><div class="report-stat-label">Medium</div><div class="report-stat-value medium">${counts.medium}</div></div>
    <div class="report-stat"><div class="report-stat-label">Low</div><div class="report-stat-value ok">${counts.low}</div></div>
  `;
  body.appendChild(summary);

  const list = document.createElement('div');
  list.className = 'report-findings-list';
  body.appendChild(list);

  [...findings]
    .sort((a,b) => SEV_ORDER.indexOf(a.sev) - SEV_ORDER.indexOf(b.sev))
    .forEach((f, i) => {
      setTimeout(() => {
        const card = document.createElement('div');
        card.className = `report-finding ${f.sev}`;
        card.style.animationDelay = `${i * 60}ms`;
        const conf = f.confidence != null ? Math.round(f.confidence * 100) : null;
        const confColor = conf >= 80 ? 'var(--phase-report)' : conf >= 60 ? 'var(--phase-verify)' : 'var(--sev-critical)';
        card.innerHTML = `
          <div class="finding-header">
            <span class="finding-sev ${f.sev}">${f.sev}</span>
            ${conf != null ? `<span class="finding-confidence" style="color:${confColor};">${conf}%</span>` : ''}
            ${f.humanReviewed ? `<span class="finding-human-badge">👤 reviewed</span>` : ''}
            ${f.amended ? `<span class="finding-amended-badge">~ amended</span>` : ''}
            <span class="finding-agent">${f.agent || ''}</span>
          </div>
          <div class="finding-title">${f.title}</div>
          <div class="finding-desc">${f.desc}</div>
          ${f.verifierReason ? `<div class="finding-verifier-note">${f.verifierReason}</div>` : ''}
        `;
        list.appendChild(card);
        const rc = document.getElementById('report-count');
        if (rc) rc.textContent = `${list.children.length} findings`;
      }, i * 80);
    });
}

// ── Markdown export ───────────────────────────────────────────
export function buildMarkdownReport(session) {
  const { prompt, effort, findings, brief, timestamp } = session;
  const lines = [
    `# Mission Control Report`,
    ``,
    `**Date:** ${new Date(timestamp).toLocaleString()}`,
    `**Prompt:** ${prompt}`,
    `**Effort:** ${effort}`,
    ``,
    `---`,
    ``,
  ];

  if (brief) {
    lines.push(`## Executive Brief`, ``, `**${brief.headline}**`, ``);
    (brief.brief || []).forEach(f => {
      lines.push(`### ${f.title}`);
      lines.push(`*${f.sev?.toUpperCase()} · ${(f.sourceAgents||[]).join(', ')}*`);
      if (f.action) lines.push(``, `**Action:** ${f.action}`);
      lines.push(``);
    });
    if (brief.recommendation) lines.push(`**▶ Do first:** ${brief.recommendation}`, ``);
    if (brief.watchOut) lines.push(`**⚠ Watch out:** ${brief.watchOut}`, ``);
    lines.push(`---`, ``, `## All Findings (${findings?.length || 0})`, ``);
  } else {
    lines.push(`## Findings`, ``);
  }

  (findings || [])
    .sort((a,b) => SEV_ORDER.indexOf(a.sev) - SEV_ORDER.indexOf(b.sev))
    .forEach(f => {
      lines.push(`### [${(f.sev||'info').toUpperCase()}] ${f.title}`);
      lines.push(`*Agent: ${f.agent || '—'} · Confidence: ${f.confidence != null ? Math.round(f.confidence*100)+'%' : '—'}*`);
      lines.push(``, f.desc || '', ``);
    });

  return lines.join('\n');
}
