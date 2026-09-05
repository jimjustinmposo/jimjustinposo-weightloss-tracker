export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

export function fmt(n, d = 0) {
  const v = Number(n);
  return Number.isFinite(v)
    ? v.toLocaleString(undefined, { maximumFractionDigits: d })
    : '—';
}

const pad = (n) => String(n).padStart(2, '0');
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function shiftDate(str, delta) {
  const [y, m, d] = str.split('-').map(Number);
  return todayStr(new Date(y, m - 1, d + delta));
}
export function prettyDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
export function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------- Toast ---------- */
export function toast(msg, type = 'success') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `${type === 'error' ? icons.alert : icons.check}<span>${esc(msg)}</span>`;
  root.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2600);
}

/* ---------- Modal ---------- */
export function openModal({ title = '', body = '' }) {
  const root = document.getElementById('modal-root');
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="icon-btn modal-close" aria-label="Close">${icons.x}</button>
      </div>
      <div class="modal-body">${body}</div>
    </div>`;
  root.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  qs('.modal-close', ov).addEventListener('click', close);
  document.body.classList.add('no-scroll');
  new MutationObserver((_, obs) => {
    if (!ov.isConnected) { document.body.classList.remove('no-scroll'); obs.disconnect(); }
  }).observe(root, { childList: true });
  return { overlay: ov, close };
}

/* ---------- Icons (inline SVG, stroke style) ---------- */
function ic(paths) {
  return `<svg class="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

export const icons = {
  heart: ic('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/><path d="M4.8 11.6h3.4l1.5-2.3 2.8 4.8 1.6-2.5h4.9"/>'),
  home: ic('<path d="M3 11l9-8 9 8"/><path d="M5 9.5V21h14V9.5"/>'),
  utensils: ic('<path d="M5 3v7a2 2 0 0 0 4 0V3"/><path d="M7 3v18"/><path d="M17 3c-1.8 0-3 1.7-3 3.6V13h3v8"/>'),
  scale: ic('<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M12 5V3"/><path d="M8.5 13.5a3.5 3.5 0 0 1 7 0z"/>'),
  steps: ic('<ellipse cx="7.5" cy="7.5" rx="2.4" ry="4.2"/><ellipse cx="16.5" cy="14" rx="2.4" ry="4.2"/><circle cx="5" cy="14.5" r=".7"/><circle cx="10" cy="14.5" r=".7"/><circle cx="14" cy="21" r=".7"/><circle cx="19" cy="21" r=".7"/>'),
  chart: ic('<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>'),
  user: ic('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  logout: ic('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>'),
  trash: ic('<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
  search: ic('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>'),
  x: ic('<path d="M18 6L6 18M6 6l12 12"/>'),
  check: ic('<path d="M20 6L9 17l-5-5"/>'),
  alert: ic('<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>'),
  flame: ic('<path d="M12 2c1 4-3 5.5-3 9a3 3 0 0 0 6 .3c0-.9-.4-1.8-.4-1.8C16.5 10.7 18 12.8 18 15a6 6 0 0 1-12 0c0-5 5-7.5 6-13z"/>'),
  target: ic('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'),
  calendar: ic('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  chevD: ic('<path d="M6 9l6 6 6-6"/>'),
  pencil: ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  camera: ic('<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.6"/>'),
};

