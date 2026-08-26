import api from './api.js';
import { App } from './state.js';
import { icons, fmt, esc, toast, openModal, todayStr, qs, qsa } from './util.js';
import { lineChart, barChart, ring, macroBar, emptyChart } from './charts.js';
import { foodPickerModal } from './foods.js';
import { DIET_OPTIONS } from './profile.js';

function mealLabel(m) {
  return { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' }[m] || m;
}

/* Label + hint for the profile's chosen diet — reuses the Profile page options so
   the dashboard indicator always matches exactly what the user picked. */
function dietInfo(value) {
  if (!value) return null;
  const found = DIET_OPTIONS.find(([v]) => v === value);
  if (found) return { label: found[1], hint: found[2] };
  // Graceful fallback for unknown values: "my_diet" → "My Diet"
  return {
    label: String(value).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    hint: '',
  };
}

function bmiBadgeClass(bmiValue) {
  if (bmiValue == null) return '';
  const v = Number(bmiValue);
  if (v < 18.5) return 'warn';
  if (v < 25) return 'ok';
  if (v < 30) return 'warn';
  return 'bad';
}

/* Animate every progress ring: the colored arc sweeps from empty to its true
   fraction (pure attribute tweening — works in every browser) while the center
   number counts up. E.g. 800/1600 kcal → the circle ends exactly half blue. */
function animateRings(rootEl, dur = 900) {
  qsa('.ring-wrap', rootEl).forEach((wrapEl) => {
    const fg = qs('.ring-fg', wrapEl);
    const bigEl = qs('.ring-center .big', wrapEl);
    if (!fg) return;

    const C = Number(fg.dataset.c || 0);         // full circumference
    const targetOff = Number(fg.dataset.off || 0); // final offset for the true fraction
    const targetNum = bigEl ? Number(String(bigEl.textContent).replace(/[^0-9.-]/g, '')) : NaN;

    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      fg.setAttribute('stroke-dashoffset', (C - (C - targetOff) * eased).toFixed(2));
      if (bigEl && Number.isFinite(targetNum) && targetNum > 0) {
        bigEl.textContent = fmt(Math.round(targetNum * eased));
      }
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function weightModal(onSaved) {
  const { overlay, close } = openModal({
    title: 'Log current weight',
    body: `
      <form id="w-form">
        <div class="form-row">
          <div class="field"><label>Date</label>
            <input type="date" name="date" value="${todayStr()}" max="${todayStr()}" required /></div>
          <div class="field"><label>Weight (kg)</label>
            <input type="number" name="weight" step="0.1" min="25" max="450"
              value="${esc(App.profile?.current_weight ?? '')}" placeholder="e.g. 92.5" required /></div>
        </div>
        <button class="btn block accent" type="submit">${icons.scale} Save Weight</button>
      </form>`,
  });
  qs('#w-form', overlay).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api.post('/api/weights', { date: f.date.value, weight: Number(f.weight.value) });
      close();
      toast('Weight saved');
      onSaved?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

export function stepsModal(onSaved, entry = null) {
  const goal = App.profile?.step_goal ?? 10000;
  const editing = !!entry;
  const { overlay, close } = openModal({
    title: editing ? 'Edit steps' : 'Add steps',
    body: `
      <form id="s-form">
        <div class="form-row">
          <div class="field"><label>Date</label>
            <input type="date" name="date" value="${esc(entry?.log_date ?? todayStr())}" max="${todayStr()}" required /></div>
          <div class="field"><label>Steps</label>
            <input type="number" name="steps" step="1" min="0" max="200000" placeholder="e.g. 10000"
              value="${entry?.steps != null ? Number(entry.steps) : ''}" required /></div>
        </div>
        <p class="form-hint">Calories burned are estimated from your height &amp; weight. Daily goal: ${fmt(goal)} steps.</p>
        <br/>
        <button class="btn block accent" type="submit">${icons.steps} ${editing ? 'Update Steps' : 'Save Steps'}</button>
      </form>`,
  });
  qs('#s-form', overlay).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api.post('/api/steps', { date: f.date.value, steps: Number(f.steps.value) });
      close();
      toast(editing ? 'Steps updated' : 'Steps saved');
      onSaved?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
function mealGroupHtml(meal, entries) {
  const kcal = entries.reduce((s, e) => s + Number(e.calories || 0), 0);
  const rows = entries.map((e) => `
    <div class="lrow">
      <div class="grow">
        <div class="title">${esc(e.name)}</div>
        <div class="meta">${fmt(e.grams)} g ·
          <span class="macro-mini"><b>P</b> ${fmt(e.protein, 1)} · <b>C</b> ${fmt(e.carbs, 1)} · <b>F</b> ${fmt(e.fat, 1)}</span>
        </div>
      </div>
      <span class="kcal">${fmt(Number(e.calories))} kcal</span>
      <button class="icon-btn del-log" data-id="${e.id}" title="Delete entry">${icons.trash}</button>
    </div>`).join('');
  return `
    <div class="meal-group">
      <div class="meal-head"><span>${mealLabel(meal)}</span><span>${fmt(kcal)} kcal</span></div>
      ${rows || '<div class="empty" style="padding:10px">Nothing logged</div>'}
    </div>`;
}

export async function renderDashboard(root) {
  const date = App.date;
  root.innerHTML = `<div class="boot-loader"><div class="spinner"></div></div>`;
  const d = await api.get(`/api/dashboard?date=${date}`);

  // keep fresh profile in state
  App.profile = d.profile;

  const t = d.targets;
  const consumed = d.consumed;
  const calorieTarget = Number(t?.calorie_target ?? 0);
  const stepGoal = Number(t?.step_goal ?? 10000);

  /* ---- rings & macros ---- */
  const calRingPct = calorieTarget ? (consumed.calories / calorieTarget) * 100 : 0;
  const stepPct = stepGoal ? (d.steps / stepGoal) * 100 : 0;
  const firstName = (App.user?.name || '').split(' ')[0] || 'there';

  /* Diet indicator — shows which macro plan is active, e.g. "Macros today · Keto". */
  const diet = dietInfo(App.profile?.diet_type);
  const dietPill = diet
    ? `<span class="diet-pill"${diet.hint ? ` title="${esc(diet.hint)}"` : ''}>${esc(diet.label)}</span>`
    : '';

  const heroHtml = `
    <section class="card hero">
      <div class="hi">
        <h2>${new Date(date + 'T00:00').toLocaleDateString(undefined, { weekday: 'long' })}, ${esc(firstName)} 👋</h2>
        <p>Your daily health snapshot — stay consistent!</p>
      </div>
      <input type="date" id="dash-date" class="date-pick" value="${date}" max="${todayStr()}" />
      <div class="hero-actions">
        <button class="btn accent" id="qa-food">${icons.plus} Log Food</button>
        <button class="btn ghost" id="qa-weight">${icons.scale} Log Weight</button>
        <button class="btn ghost" id="qa-steps">${icons.steps} Add Steps</button>
      </div>
    </section>`;

  const ringsHtml = `
    <section class="grid grid-c3">
      <div class="card" style="text-align:center">
        <h3>${icons.flame} Calories</h3>
        ${ring({
          pct: calRingPct, size: 132, color: calRingPct > 105 ? 'var(--danger)' : 'var(--primary)',
          big: fmt(Math.max(calorieTarget - Number(d.net_calories), 0)),
          sub: `of ${fmt(calorieTarget)} left`,
        })}
        <p style="font-size:12px;color:var(--muted);margin-top:8px">
          Eaten <b>${fmt(consumed.calories)}</b> · Burned <b>${fmt(d.burned_steps)}</b> · Net <b>${fmt(d.net_calories)}</b>
        </p>
      </div>
      <div class="card" style="text-align:center">
        <h3>${icons.steps} Steps</h3>
        ${ring({ pct: stepPct, size: 132, color: 'var(--accent)', big: fmt(d.steps), sub: `of ${fmt(stepGoal)}` })}
        <p style="font-size:12px;color:var(--muted);margin-top:8px">≈ <b>${fmt(d.burned_steps)}</b> kcal burned walking</p>
      </div>
      <div class="card">
        <h3>${icons.utensils} Macros today ${dietPill}</h3>
        ${macroBar('Protein', consumed.protein, Number(t?.protein_target ?? 0), '#1976D2')}
        ${macroBar('Carbs', consumed.carbs, Number(t?.carb_target ?? 0), '#FBC02D')}
        ${macroBar('Fat', consumed.fat, Number(t?.fat_target ?? 0), '#E53935')}
        <div class="balance-strip" style="margin-top:14px">
          <div class="cell"><b>${fmt(consumed.calories)}</b><span>Eaten</span></div>
          <div class="cell"><b>${fmt(d.burned_steps)}</b><span>Burned</span></div>
          <div class="cell"><b>${fmt(d.net_calories)}</b><span>Net</span></div>
          <div class="cell"><b style="color:${Number(d.remaining_calories) < 0 ? 'var(--danger)' : 'var(--accent)'}">${fmt(d.remaining_calories)}</b><span>Left</span></div>
        </div>
      </div>
    </section>`;
  /* ---- charts ---- */
  const weights = d.weight_series || [];
  let weightChart;
  if (weights.length >= 2) {
    const first = Number(weights[0].weight), last = Number(weights[weights.length - 1].weight);
    const delta = last - first;
    weightChart = `
      <div class="card">
        <h3 style="justify-content:space-between"><span style="display:flex;align-items:center;gap:8px">${icons.scale} Weight Tracker</span>
          <span class="delta-pill ${delta <= 0 ? 'down' : 'up'}">${delta <= 0 ? '▼' : '▲'} ${fmt(Math.abs(delta), 1)} kg</span></h3>
        ${lineChart(weights.map((w) => ({ label: w.log_date, y: Number(w.weight) })),
    { color: '#1976D2', height: 210, fmtVal: (v) => `${fmt(v, 1)} kg`, fmtY: (v) => fmt(v, 0) })}
      </div>`;
  } else {
    weightChart = `<div class="card"><h3>${icons.scale} Weight Tracker</h3>
      ${emptyChart('Log your weight at least twice to see your trend')}</div>`;
  }

  const stepsChart = `
    <div class="card">
      <h3>${icons.steps} Steps — last 7 days</h3>
      ${barChart((d.steps_series || []).map((s) => ({ label: s.log_date, value: Number(s.steps) })),
    { color: '#43A047', height: 210, target: stepGoal })}
    </div>`;

  const calChart = `
    <div class="card">
      <h3>${icons.flame} Calories — last 7 days</h3>
      ${(d.calories_series || []).some((c) => Number(c.calories) > 0)
    ? lineChart((d.calories_series || []).map((c) => ({ label: c.log_date, y: Number(c.calories) })),
      { color: '#F57C00', height: 210, target: calorieTarget || null, fmtVal: (v) => fmt(v) })
    : emptyChart('Log food to build your calorie history')}
    </div>`;

  /* ---- quick actions & meals ---- */
  const mealsHtml = ['breakfast', 'lunch', 'dinner', 'snack']
    .map((m) => mealGroupHtml(m, d.meals?.[m] || []))
    .join('');

  root.innerHTML = `
    ${heroHtml}
    <br/>
    ${ringsHtml}
    <br/>
    <section class="card">
      <div class="qa-row">
        <div class="qa-badges">
          ${t?.bmi != null ? `<span class="badge ${bmiBadgeClass(t.bmi)}">${icons.chart} BMI <b>${fmt(t.bmi, 1)}</b> · ${esc(t.bmi_category || '')}</span>` : ''}
          ${t?.tdee != null ? `<span class="badge">${icons.flame} TDEE <b>${fmt(t.tdee)}</b></span>` : ''}
          ${t?.goal_type ? `<span class="badge">${icons.target} Goal: <b>${esc(String(t.goal_type))}</b> ${t.goal_type !== 'maintain' ? `${fmt(Math.abs(Number(t.weekly_goal_kg) || 0), 2)} kg/wk` : ''}</span>` : ''}
        </div>
        ${t ? `<span style="margin-left:auto;align-self:center;font-size:12.5px;color:var(--muted)">
          Daily targets — kcal <b>${fmt(calorieTarget)}</b> · P <b>${fmt(t.protein_target)}g</b> · C <b>${fmt(t.carb_target)}g</b> · F <b>${fmt(t.fat_target)}g</b></span>` : ''}
      </div>
    </section>
    <br/>
    <section class="charts-grid">${weightChart}${stepsChart}${calChart}</section>
    <br/>
    <section class="card">
      <h3>${icons.utensils} Daily Food Intake Record — ${new Date(date + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</h3>
      ${mealsHtml || '<div class="empty">No food logged yet for this day.</div>'}
    </section>`;

  /* ---- dynamic rings: sweep arcs + count numbers up ---- */
  animateRings(root);

  /* ---- wiring ---- */
  qs('#dash-date', root).addEventListener('change', (e) => {
    App.date = e.target.value || todayStr();
    renderDashboard(root);
  });
  qs('#qa-weight', root).addEventListener('click', () => weightModal(() => renderDashboard(root)));
  qs('#qa-steps', root).addEventListener('click', () => stepsModal(() => renderDashboard(root)));
  qs('#qa-food', root).addEventListener('click', () => foodPickerModal(() => renderDashboard(root)));

  qsa('.del-log', root).forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this food entry?')) return;
      try {
        await api.del(`/api/logs/${btn.dataset.id}`);
        toast('Entry deleted');
        renderDashboard(root);
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}



