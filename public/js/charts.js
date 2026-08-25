import { fmt, clamp } from './util.js';

let uid = 0;

function niceMax(v) {
  if (!(v > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  let s;
  if (n <= 1) s = 1; else if (n <= 2) s = 2; else if (n <= 2.5) s = 2.5; else if (n <= 5) s = 5; else s = 10;
  return s * mag;
}

function shortLabel(s) {
  // "2026-08-24" -> "Aug 24"
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const W = 640;

export function emptyChart(msg = 'No data yet') {
  return `<div class="chart-empty">${msg}</div>`;
}

/** items: [{ label: 'YYYY-MM-DD', y: number }] */
export function lineChart(items, opts = {}) {
  const {
    color = '#1976D2', height = 210, area = true,
    target = null, targetColor = '#E53935',
    fmtY = (v) => fmt(v), fmtVal = (v) => fmt(v),
  } = opts;
  const pts = items.filter((p) => p && p.y != null && Number.isFinite(Number(p.y))).map((p) => ({ ...p, y: Number(p.y) }));
  if (!pts.length) return emptyChart();

  const H = height, padL = 46, padR = 14, padT = 16, padB = 26;
  const ys = pts.map((p) => p.y);
  if (target != null) ys.push(target);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const span = hi - lo;
  lo = Math.max(0, lo - span * 0.12);
  hi += span * 0.12;
  const top = niceMax(hi);
  const baseY = padT + H - padT - padB;
  const X = (i) => padL + (W - padL - padR) * (pts.length === 1 ? 0.5 : i / (pts.length - 1));
  const Y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / (top - lo));

  let dPath = '';
  pts.forEach((p, i) => { dPath += `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.y).toFixed(1)} `; });
  const gradId = `lg${++uid}`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (top - lo) * f);
  const grid = ticks.map((v) => `
    <line x1="${padL}" y1="${Y(v).toFixed(1)}" x2="${W - padR}" y2="${Y(v).toFixed(1)}" stroke="#E6ECF5" stroke-width="1"/>
    <text x="${padL - 7}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="#8A97A8">${fmtY(v)}</text>`).join('');

  const lblEvery = Math.max(1, Math.ceil(pts.length / 6));
  const xLabels = pts.map((p, i) => (i % lblEvery === 0 || i === pts.length - 1
    ? `<text x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#8A97A8">${shortLabel(p.label)}</text>`
    : '')).join('');

  const targetLine = target != null && target >= lo && target <= top
    ? `<line x1="${padL}" y1="${Y(target).toFixed(1)}" x2="${W - padR}" y2="${Y(target).toFixed(1)}"
         stroke="${targetColor}" stroke-width="1.4" stroke-dasharray="5 4" opacity=".8"/>
       <text x="${W - padR}" y="${(Y(target) - 5).toFixed(1)}" text-anchor="end" font-size="10" font-weight="700" fill="${targetColor}">goal ${fmtVal(target)}</text>`
    : '';

  const dots = pts.map((p, i) => `
    <circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3.1" fill="#fff" stroke="${color}" stroke-width="2">
      <title>${shortLabel(p.label)}: ${fmtVal(p.y)}</title>
    </circle>`).join('');

  const areaPath = area
    ? `<path d="${dPath}L${X(pts.length - 1).toFixed(1)} ${baseY.toFixed(1)} L${X(0).toFixed(1)} ${baseY.toFixed(1)} Z" fill="url(#${gradId})"/>`
    : '';

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">
    <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".28"/>
      <stop offset="100%" stop-color="${color}" stop-opacity=".02"/>
    </linearGradient></defs>
    ${grid}${targetLine}${areaPath}
    <path d="${dPath}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${xLabels}
  </svg>`;
}
/** items: [{ label, value }] */
export function barChart(items, opts = {}) {
  const {
    color = '#43A047', height = 210,
    target = null, targetColor = '#E53935',
    fmtVal = (v) => fmt(v),
  } = opts;
  const data = (items || []).map((p) => ({ ...p, value: Number(p.value) || 0 }));
  if (!data.length) return emptyChart();

  const H = height, padL = 46, padR = 14, padT = 18, padB = 26;
  const maxV = niceMax(Math.max(...data.map((d) => d.value), target ?? 0, 1) * 1.08);
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const band = innerW / data.length;
  const bw = Math.min(band * 0.62, 46);
  const Y = (v) => padT + innerH * (1 - v / maxV);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => maxV * f);
  const grid = ticks.map((v) => `
    <line x1="${padL}" y1="${Y(v).toFixed(1)}" x2="${W - padR}" y2="${Y(v).toFixed(1)}" stroke="#E6ECF5" stroke-width="1"/>
    <text x="${padL - 7}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="#8A97A8">${fmt(Math.round(v))}</text>`).join('');

  const bars = data.map((d, i) => {
    const x = padL + band * i + (band - bw) / 2;
    const y = Y(d.value);
    const h = Math.max(padT + innerH - y, 1.5);
    const hitGoal = target ? d.value >= target : false;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${color}" opacity="${hitGoal ? 1 : 0.78}">
      <title>${shortLabel(d.label)}: ${fmtVal(d.value)}</title>
    </rect>
    <text x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#5B6B80">${fmtVal(d.value)}</text>
    <text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#8A97A8">${shortLabel(d.label)}</text>`;
  }).join('');

  const targetLine = target != null && target > 0 && target <= maxV
    ? `<line x1="${padL}" y1="${Y(target).toFixed(1)}" x2="${W - padR}" y2="${Y(target).toFixed(1)}"
         stroke="${targetColor}" stroke-width="1.4" stroke-dasharray="5 4" opacity=".85"/>
       <text x="${W - padR}" y="${(Y(target) - 5).toFixed(1)}" text-anchor="end" font-size="10" font-weight="700" fill="${targetColor}">goal ${fmt(target)}</text>`
    : '';

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${grid}${bars}${targetLine}</svg>`;
}

/** Circular progress ring (returns wrapper HTML with centered content). */
export function ring({ pct, size = 128, stroke = 11, color = '#1976D2', big = '', sub = '' }) {
  let p = Number(pct) || 0;
  if (p > 1) p /= 100; // accept 0–1 or 0–100 so the arc always reflects real progress
  p = clamp(p, 0, 1);
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const off = C * (1 - p);
  return `
    <div class="ring-wrap" style="width:${size}px">
      <svg viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#E8EEF7" stroke-width="${stroke}"/>
        <circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
          stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
          style="--ring-c:${C.toFixed(1)}"/>
      </svg>
      <div class="ring-center"><span class="big">${big}</span><span class="sub">${sub}</span></div>
    </div>`;
}

/** Linear progress bar row. */
export function macroBar(label, value, max, color) {
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
  const over = value > max && max > 0;
  return `
    <div class="macro-row">
      <div class="macro-head"><span style="display:flex;align-items:center;gap:6px;color:${over ? '#E53935' : 'inherit'}">
        ${label}${over ? ' ↑' : ''}</span><span>${fmt(value, 1)} / ${fmt(max)} g</span></div>
      <div class="bar"><i style="width:${pct.toFixed(1)}%;background:${color}"></i></div>
    </div>`;
}

