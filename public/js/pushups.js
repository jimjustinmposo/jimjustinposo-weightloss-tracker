import api from './api.js';
import { App } from './state.js';
import { icons, fmt, esc, toast, prettyDate, qs, qsa } from './util.js';
import { barChart, emptyChart } from './charts.js';
import { pushupsModal } from './dashboard.js';

export async function renderPushups(root) {
  root.innerHTML = `<div class="boot-loader"><div class="spinner"></div></div>`;

  const [seriesData, entriesData] = await Promise.all([
    api.get('/api/pushups?days=30'),
    api.get('/api/pushups/entries?limit=180'),
  ]);

  const series = seriesData.series || []; // last 30 days incl. zero-filled gaps
  const entries = entriesData.entries || []; // only logged days, newest first
  const goal = App.profile?.pushup_goal ?? 50;

  /* ---- summary stats ---- */
  const last7 = series.slice(-7);
  const weekAvg = last7.length
    ? Math.round(last7.reduce((s, d) => s + Number(d.pushups || 0), 0) / last7.length)
    : 0;
  const best = entries.reduce((b, e) => Math.max(b, Number(e.pushups || 0)), 0);
  const totalBurn = entries.reduce((s, e) => s + Number(e.calories_burned || 0), 0);
  const daysHit = entries.filter((e) => Number(e.pushups || 0) >= goal).length;

  const chartHtml = series.some((s) => Number(s.pushups) > 0)
    ? barChart(
        series.map((s) => ({ label: s.log_date, value: Number(s.pushups) })),
        { color: '#E53935', height: 220, target: goal }
      )
    : emptyChart('No pushups logged yet — hit "Add Pushups" to get started!');

  /* ---- record rows (pushup_logs is keyed by user + date — no id column) ---- */
  const rows = entries
    .map((e) => {
      const hit = Number(e.pushups || 0) >= goal;
      return `
      <div class="lrow">
        <div class="grow">
          <div class="title">${prettyDate(e.log_date)}</div>
          <span class="meta">≈ ${fmt(Number(e.calories_burned))} kcal burned</span>
        </div>
        <span class="kcal">${fmt(Number(e.pushups))} pushups</span>
        ${hit ? '<span class="delta-pill down">✓ goal</span>' : ''}
        <button class="icon-btn edit-pushup" data-date="${esc(e.log_date)}"
          data-pushups="${Number(e.pushups)}" title="Edit">${icons.pencil}</button>
        <button class="icon-btn del-pushup" data-date="${esc(e.log_date)}" title="Delete">${icons.trash}</button>
      </div>`;
    })
    .join('');

  root.innerHTML = `
    <div class="page-title">
      <div><h2>Pushups Record</h2><p>Every day you did pushups — update or remove any entry.</p></div>
      <button class="btn accent" id="add-pushups-btn">${icons.plus} Add Pushups</button>
    </div>
    <section class="grid grid-auto">
      <div class="card">
        <h3>${icons.pushups} Pushups — last 30 days</h3>
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
          ${rows || `<div class="empty">${icons.pushups}<p>No pushups recorded yet.<br/>Log your first day to see it here.</p></div>`}
        </div>
      </div>
    </section>`;

  /* ---- wiring ---- */
  qs('#add-pushups-btn', root).addEventListener('click', () => pushupsModal(() => renderPushups(root)));

  qsa('.edit-pushup', root).forEach((btn) =>
    btn.addEventListener('click', () =>
      pushupsModal(() => renderPushups(root), { log_date: btn.dataset.date, pushups: btn.dataset.pushups })
    )
  );

  qsa('.del-pushup', root).forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this pushups entry?')) return;
      try {
        await api.del(`/api/pushups/${encodeURIComponent(btn.dataset.date)}`);
        toast('Entry deleted');
        renderPushups(root);
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}
