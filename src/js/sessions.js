// sessions.js
import { state, persistSessions, clearStoredSessions } from './state.js';
import { toast } from './ui.js';

export function saveSession(session) {
  state.sessions.unshift(session);
  persistSessions();
  renderSessionList();
}

export function renderSessionList() {
  const list = document.getElementById('sessions-list');
  if (!state.sessions.length) {
    list.innerHTML = '<div class="no-sessions">No sessions yet</div>';
    return;
  }
  list.innerHTML = state.sessions.map((s, i) => `
    <div class="session-item ${state.currentSession?.id === s.id ? 'active':''}"
         onclick="window.loadSession(${i})">
      <div class="session-title">${esc(s.prompt.slice(0,50))}${s.prompt.length>50?'…':''}</div>
      <div class="session-meta">
        <span>${new Date(s.timestamp).toLocaleDateString()}</span>
        <span>${s.findings?.length||0} findings</span>
        <span>${s.effort}</span>
      </div>
    </div>`).join('');
}

export function clearAllSessions() {
  if (!confirm('Clear all sessions?')) return;
  clearStoredSessions();
  renderSessionList();
  toast('Sessions cleared');
}

function esc(s='') {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
