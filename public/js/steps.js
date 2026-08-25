import api from './api.js';
import { App } from './state.js';
import { icons, fmt, esc, toast, prettyDate, qs, qsa } from './util.js';
import { barChart, emptyChart } from './charts.js';
import { stepsModal } from './dashboard.js';

export async function renderSteps(root) {
  root.innerHTML = `<div class="boot-loader"><div class="spinner"></div></div>`;

  const [seriesData, entriesData] = await Promise.all([
    api.get('/api/steps?days=30'),
    api.get('/api/steps/entries?limit=180'),
  ]);

  const series = seriesData.series || []; // last 30 days incl. zero-filled gaps
  const entries = entriesData.entries || []; // only logged days, newest first
  const goal = App.profile?.step_goal ?? 10000;

  /* ---- summary stats ---- */
  const last7 = series.slice(-7);
  const weekAvg = last7.length
    ? Math.round(last7.reduce((s, d) => s + Number(d.steps || 0), 0) / last7.length)
    : 0;
  const best = entries.reduce((b, e) => Math.max(b, Number(e.steps || 0)), 0);
  const totalBurn = entries.reduce((s, e) => s + Number(e.calories_burned || 0), 0);
  const daysHit = entries.filter((e) => Number(e.steps || 0) >= goal).length;

  const chartHtml = series.some((s) => Number(s.steps) > 0)
    ? barChart(
        series.map((s) => ({ label: s.log_date, value: Number(s.steps) })),
        { color: '#43A047', height: 220, target: goal }
      )
    : emptyChart('No steps logged yet — hit “Add Steps” to get moving!');

  /* ---- record rows (step_logs is keyed by user + date — no id column) ---- */
  const rows = entries
    .map((e) => {
      const hit = Number(e.steps || 0) >= goal;
      return `
      <div class="lrow">
        <div class="grow">
          <div class="title">${prettyDate(e.log_date)}</div>
          <span class="meta">≈ ${fmt(Number(e.calories_burned))} kcal burned</span>
        </div>
        <span class="kcal">${fmt(Number(e.steps))} steps</span>
        ${hit ? '<span class="delta-pill down">✓ goal</span>' : ''}
        <button class="icon-btn edit-step" data-date="${esc(e.log_date)}"
          data-steps="${Number(e.steps)}" title="Edit">${icons.pencil}</button>
        <button class="icon-btn del-step" data-date="${esc(e.log_date)}" title="Delete">${icons.trash}</button>
      </div>`;
    })
    .join('');

  root.innerHTML = `
    <div class="page-title">
      <div><h2>Steps Record</h2><p>Every day you walked — update or remove any entry.</p></div>
      <button class="btn accent" id="add-steps-btn">${icons.plus} Add Steps</button>
    </div>
    <section class="grid grid-auto">
      <div class="card">
        <h3>${icons.steps} Steps — last 30 days</h3>
        ${chartHtml}
        <div class="balance-strip" style="margin-top:16px">
          <div class="cell"><b>${fmt(weekAvg)}</b><span>7-day avg</span></div>
          <div class="cell"><b>${fmt(best)}</b><span>Best day</span></div>
          <div class="cell"><b>${daysHit}</b><span>Goals hit</span></div>
          <div class="cell"><b style="color:var(--accent)">${fmt(Math.round(totalBurn))}</b><span>kcal burned</span></div>
        </div>
      </div>
      <div class="card">
        <h3>${icons.calendar} Records${entries.length ? ` (${entries.length})` : ''}</h3>
        <div class="rowlist" style="max-height:480px;overflow-y:auto">
          ${rows || `<div class="empty">${icons.steps}<p>No steps recorded yet.<br/>Log your first day to see it here.</p></div>`}
        </div>
      </div>
    </section>`;

  /* ---- wiring ---- */
  qs('#add-steps-btn', root).addEventListener('click', () => stepsModal(() => renderSteps(root)));

  qsa('.edit-step', root).forEach((btn) =>
    btn.addEventListener('click', () =>
      stepsModal(() => renderSteps(root), { log_date: btn.dataset.date, steps: btn.dataset.steps })
    )
  );

  qsa('.del-step', root).forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this steps entry?')) return;
      try {
        await api.del(`/api/steps/${encodeURIComponent(btn.dataset.date)}`);
        toast('Entry deleted');
        renderSteps(root);
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}
