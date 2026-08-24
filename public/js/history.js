import api from './api.js';
import { App } from './state.js';
import { icons, fmt, esc, toast, todayStr, prettyDate, qs, qsa } from './util.js';
import { lineChart, emptyChart } from './charts.js';
import { weightModal } from './dashboard.js';

export async function renderHistory(root) {
  root.innerHTML = `<div class="boot-loader"><div class="spinner"></div></div>`;

  const [wData, logsData] = await Promise.all([
    api.get('/api/weights?limit=90'),
    api.get('/api/logs/recent?limit=500'),
  ]);

  const weights = wData.entries; // desc by date
  const entries = logsData.entries;

  /* ---- group food logs by day ---- */
  const byDay = new Map();
  for (const e of entries) {
    if (!byDay.has(e.log_date)) byDay.set(e.log_date, []);
    byDay.get(e.log_date).push(e);
  }
  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const daysHtml = days.map(([day, list]) => {
    const tot = list.reduce(
      (acc, e) => ({
        c: acc.c + Number(e.calories || 0),
        p: acc.p + Number(e.protein || 0),
        cb: acc.cb + Number(e.carbs || 0),
        f: acc.f + Number(e.fat || 0),
      }),
      { c: 0, p: 0, cb: 0, f: 0 }
    );
    const rows = list.map((e) => `
      <div class="lrow" style="padding-left:10px">
        <div class="grow">
          <div class="title">${esc(e.name)} <span style="font-weight:400;color:var(--muted)">· ${esc(String(e.meal))} · ${fmt(e.grams)} g</span></div>
          <span class="macro-mini"><b>P</b> ${fmt(e.protein, 1)} · <b>C</b> ${fmt(e.carbs, 1)} · <b>F</b> ${fmt(e.fat, 1)}</span>
        </div>
        <span class="kcal">${fmt(Number(e.calories))} kcal</span>
      </div>`).join('');
    return `
      <details class="day">
        <summary>${icons.calendar}<span>${prettyDate(day)}</span>
          <span class="day-totals">${fmt(tot.c)} kcal · P ${fmt(tot.p)}g C ${fmt(tot.cb)}g F ${fmt(tot.f)}g</span>
          <span class="chev">${icons.chevD}</span></summary>
        ${rows}
      </details>`;
  }).join('');

  /* ---- weight chart + delta ---- */
  const asc = weights.slice().reverse();
  let weightChartHtml;
  if (asc.length >= 2) {
    const first = Number(asc[0].weight), last = Number(asc[asc.length - 1].weight);
    const delta = last - first;
    const goalWeight = estimateGoal(App.profile);
    weightChartHtml = `
      ${lineChart(asc.map((w) => ({ label: w.log_date, y: Number(w.weight) })),
        { color: '#1976D2', height: 220, fmtVal: (v) => `${fmt(v, 1)} kg`, target: goalWeight, targetColor: '#43A047' })}
      <div style="display:flex;justify-content:center;margin-top:6px">
        <span class="delta-pill ${delta <= 0 ? 'down' : 'up'}">${delta <= 0 ? '▼' : '▲'} ${fmt(Math.abs(delta), 1)} kg since start</span>
      </div>`;
  } else {
    weightChartHtml = emptyChart('Log your weight at least twice to see the trend');
  }

  /* ---- weight rows ---- */
  const weightRows = weights.map((w, i) => {
    const prev = weights[i + 1];
    const diff = prev ? Number(w.weight) - Number(prev.weight) : null;
    const diffHtml = diff == null
      ? '<span class="meta">start</span>'
      : `<span class="delta-pill ${diff <= 0 ? 'down' : 'up'}">${diff <= 0 ? '▼' : '▲'} ${fmt(Math.abs(diff), 1)}</span>`;
    return `
      <div class="lrow">
        <div class="grow"><div class="title">${prettyDate(w.log_date)}</div></div>
        <span class="kcal">${fmt(w.weight, 1)} kg</span>
        ${diffHtml}
        <button class="icon-btn del-weight" data-id="${w.id}" title="Delete">${icons.trash}</button>
      </div>`;
  }).join('') || '<div class="empty">No weigh-ins yet.</div>';

  root.innerHTML = `
    <div class="page-title">
      <div><h2>History &amp; Records</h2><p>Daily food diary and full weight log.</p></div>
    </div>
    <section class="grid grid-auto">
      <div class="card">
        <h3 style="justify-content:space-between"><span style="display:flex;align-items:center;gap:8px">${icons.scale} Weight Tracker</span>
          <button class="btn sm accent" id="hist-add-weight">${icons.plus} Add</button></h3>
        ${weightChartHtml}
        <br/>
        <div class="rowlist" style="max-height:340px;overflow-y:auto">${weightRows}</div>
      </div>
      <div class="card">
        <h3>${icons.utensils} Daily Food Taken History</h3>
        ${daysHtml || `<div class="empty">${icons.utensils}<p>No food logged yet.</p></div>`}
      </div>
    </section>`;

  qs('#hist-add-weight', root).addEventListener('click', () => weightModal(() => renderHistory(root)));

  qsa('.del-weight', root).forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this weight entry?')) return;
      try {
        await api.del(`/api/weights/${btn.dataset.id}`);
        toast('Entry deleted');
        renderHistory(root);
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}

function estimateGoal(profile) {
  if (!profile?.height_cm || !App.profile?.goal_type) return null;
  // healthy BMI midpoint (22) as a rough long-run reference line on the chart
  const h = Number(profile.height_cm) / 100;
  return Math.round((22 * h * h) * 10) / 10;
}
