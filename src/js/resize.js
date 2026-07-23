// resize.js

const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 420;
const MIN_AGENTS  = 400;
const MAX_AGENTS  = 1200;
const MIN_CENTER  = 280;
const STORAGE_KEY = 'mc_panel_sizes';

export function initResize() {
  // Restore saved sizes
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.sidebar) setCol('--col-sidebar', saved.sidebar);
    if (saved.agents)  setCol('--col-agents',  saved.agents);
  } catch(e) {}

  // Wait for layout paint before positioning
  requestAnimationFrame(() => {
    positionHandles();
    setupHandle('handle-sidebar', 'sidebar');
    setupHandle('handle-agents',  'agents');
  });

  window.addEventListener('resize', positionHandles);
}

function setupHandle(handleId, which) {
  const handle = document.getElementById(handleId);
  if (!handle) return;

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    handle.classList.add('dragging');
    document.body.classList.add('resizing');

    const startX      = e.clientX;
    const startSidebar = getCol('--col-sidebar');
    const startAgents  = getCol('--col-agents');
    const appW         = document.getElementById('app').offsetWidth;

    function onMove(e) {
      const dx = e.clientX - startX;

      if (which === 'sidebar') {
        const newW = clamp(startSidebar + dx, MIN_SIDEBAR, MAX_SIDEBAR);
        if (appW - newW - getCol('--col-agents') >= MIN_CENTER) {
          setCol('--col-sidebar', newW);
        }
      } else {
        // agents handle dragged left = wider agents
        const newW = clamp(startAgents - dx, MIN_AGENTS, MAX_AGENTS);
        if (appW - getCol('--col-sidebar') - newW >= MIN_CENTER) {
          setCol('--col-agents', newW);
        }
      }
      positionHandles();
    }

    function onUp() {
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      saveSizes();
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  });
}

function positionHandles() {
  const app = document.getElementById('app');
  if (!app) return;

  const sidebarW = getCol('--col-sidebar');
  const agentsW  = getCol('--col-agents');
  const appW     = app.offsetWidth;

  const hSidebar = document.getElementById('handle-sidebar');
  const hAgents  = document.getElementById('handle-agents');

  // Sidebar handle sits on right edge of sidebar column
  if (hSidebar) hSidebar.style.left = (sidebarW - 2) + 'px';
  // Agents handle sits on left edge of agents column
  if (hAgents)  hAgents.style.left  = (appW - agentsW - 2) + 'px';
}

function setCol(name, px) {
  document.getElementById('app').style.setProperty(name, px + 'px');
}

function getCol(name) {
  const raw = getComputedStyle(document.getElementById('app'))
    .getPropertyValue(name).trim();
  return parseInt(raw) || 0;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function saveSizes() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sidebar: getCol('--col-sidebar'),
      agents:  getCol('--col-agents'),
    }));
  } catch(e) {}
}
