// state.js
export const state = {
  running: false,
  paused: false,
  stopped: false,
  simulated: true,
  autosave: true,
  effort: 'medium',
  sessions: [],
  currentSession: null,
  agents: [],       // live agent descriptors
  findings: [],     // verified findings
  phase: null,      // plan | scan | verify | report
};

const KEY = 'health_sessions';

export function loadSessions() {
  try {
    const s = localStorage.getItem(KEY);
    if (s) state.sessions = JSON.parse(s);
  } catch(e) {}
}

export function persistSessions() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state.sessions.slice(0, 30)));
  } catch(e) {}
}

export function clearStoredSessions() {
  state.sessions = [];
  localStorage.removeItem(KEY);
}
