import api from './api.js';
import { App, profileComplete } from './state.js';
import { icons, fmt, toast, esc, qs, todayStr } from './util.js';

const ACTIVITY_OPTIONS = [
  ['sedentary', 'Sedentary — desk job, little exercise'],
  ['light', 'Lightly active — exercise 1–3 days/wk'],
  ['moderate', 'Moderately active — exercise 3–5 days/wk'],
  ['active', 'Very active — exercise 6–7 days/wk'],
  ['athlete', 'Athlete — training twice a day / physical job'],
];

/* Diet styles that reshape the macro split (mirrors server-side dietMacros). */
const DIET_OPTIONS = [
  ['normal', 'Normal / Balanced', 'balanced split'],
  ['lowcarb', 'Low Carb', '~15% of calories from carbs'],
  ['keto', 'Keto', '20–30 g carbs · high fat'],
  ['carnivore', 'Carnivore', '0 g carbs · high protein & fat'],
  ['omad_carnivore', 'OMAD Carnivore', '0 g carbs · eat all targets in ONE meal'],
];

/* Frontend mirror of the server-side calculations for instant preview. */
function preview(p) {
  const bmr = (() => {
    const base = 10 * p.weight + 6.25 * p.height - 5 * p.age;
    if (p.gender === 'male') return base + 5;
    if (p.gender === 'female') return base - 161;
    return base - 78;
  })();
  const factors = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, athlete: 1.9 };
  const tdee = bmr * (factors[p.activity] ?? 1.375);
  const weekly = p.goal === 'maintain' ? 0 : Math.min(Math.abs(p.weekly || 0), 1.5) * (p.goal === 'lose' ? -1 : 1);
  const delta = (Math.abs(weekly) * 7700) / 7;
  const floor = p.gender === 'female' ? 1200 : 1500;
  const calories = Math.max(tdee + (weekly < 0 ? -delta : delta), floor);
  const calTarget = Math.round(calories / 10) * 10;

  /* Macro split per diet style — mirrors dietMacros() in src/calc.ts. */
  const r5 = (v) => Math.round(v / 5) * 5;
  const perKg = p.goal === 'lose' ? 2.0 : p.goal === 'gain' ? 1.8 : 1.6;
  const baseProtein = Math.max(40, r5(perKg * p.weight));
  let protein, carbs, fat;
  switch (p.diet) {
    case 'lowcarb':
      protein = baseProtein;
      carbs = Math.max(30, r5((calTarget * 0.15) / 4));
      fat = Math.max(30, r5((calTarget - protein * 4 - carbs * 4) / 9));
      break;
    case 'keto':
      carbs = Math.max(20, Math.min(r5((calTarget * 0.05) / 4), 30));
      protein = Math.min(baseProtein, Math.max(40, r5((calTarget * 0.3) / 4)));
      fat = Math.max(40, r5((calTarget - protein * 4 - carbs * 4) / 9));
      break;
    case 'carnivore':
    case 'omad_carnivore':
      protein = Math.max(60, r5(p.weight * 2.2));
      carbs = 0;
      fat = Math.max(40, r5((calTarget - protein * 4) / 9));
      break;
    default: // normal
      protein = baseProtein;
      fat = Math.max(30, r5((calTarget * 0.27) / 9));
      carbs = Math.max(30, r5((calTarget - protein * 4 - fat * 9) / 4));
  }

  const hM = p.height / 100;
  const bmiV = hM > 0 ? p.weight / (hM * hM) : 0;
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), calTarget, protein, carbs, fat,
    bmi: Math.round(bmiV * 10) / 10, weekly };
}

function bmiCat(v) {
  if (v < 18.5) return 'Underweight';
  if (v < 25) return 'Normal weight';
  if (v < 30) return 'Overweight';
  return 'Obese';
}
export function renderProfilePage(root) {
  const onboarding = !profileComplete(App.profile);
  const p = App.profile || {};

  root.innerHTML = `
    <div class="auth-wrap" style="min-height:auto;padding-top:0">
      <div class="auth-card" style="width:min(860px,100%)">
        <div class="auth-brand">
          <div class="logo">${icons.user}</div>
          <h1>${onboarding ? 'Set up your profile' : 'Your Profile'}</h1>
          <p>${onboarding
            ? 'Tell us about yourself — we’ll calculate your TDEE, BMI and daily calorie & macro targets.'
            : 'Update your details anytime — targets recalculate automatically.'}</p>
        </div>
        <div class="card">
          <form id="pf-form" novalidate>
            <div class="form-row">
              <div class="field"><label>Name</label>
                <input name="name" value="${esc(p.name ?? '')}" placeholder="Your name" /></div>
              <div class="field"><label>Age</label>
                <input name="age" type="number" min="10" max="100" value="${esc(p.age ?? '')}" placeholder="30" required /></div>
            </div>
            <div class="form-row">
              <div class="field"><label>Gender</label>
                <select name="gender">
                  <option value="male" ${p.gender === 'male' ? 'selected' : ''}>Male</option>
                  <option value="female" ${p.gender === 'female' ? 'selected' : ''}>Female</option>
                  <option value="other" ${p.gender === 'other' ? 'selected' : ''}>Other</option>
                </select></div>
              <div class="field"><label>Height (cm)</label>
                <input name="height_cm" type="number" step="0.5" min="100" max="250" value="${esc(p.height_cm ?? '')}" placeholder="175" required /></div>
            </div>
            <div class="field"><label>Lifestyle / Activity level</label>
              <select name="activity_level">
                ${ACTIVITY_OPTIONS.map(([v, l]) => `<option value="${v}" ${(p.activity_level ?? 'light') === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select></div>
            <div class="form-row">
              <div class="field"><label>Current weight (kg)</label>
                <input name="current_weight" type="number" step="0.1" min="25" max="450" value="${esc(p.current_weight ?? '')}" placeholder="92" required /></div>
              <div class="field"><label>Step goal / day</label>
                <input name="step_goal" type="number" step="500" min="1000" max="100000" value="${esc(p.step_goal ?? 10000)}" /></div>
            </div>
            <div class="form-row">
              <div class="field"><label>Goal</label>
                <select name="goal_type">
                  <option value="lose" ${(p.goal_type ?? 'lose') === 'lose' ? 'selected' : ''}>Lose weight</option>
                  <option value="maintain" ${p.goal_type === 'maintain' ? 'selected' : ''}>Maintain weight</option>
                  <option value="gain" ${p.goal_type === 'gain' ? 'selected' : ''}>Gain weight</option>
                </select></div>
              <div class="field"><label id="weekly-label">Target loss per week (kg)</label>
                <input name="weekly_goal_kg" type="number" step="0.1" min="0.1" max="1.5" value="${esc(p.weekly_goal_kg ?? 0.5)}" />
                <p class="form-hint">Safe range: 0.1 – 1.5 kg/week.</p></div>
            </div>
            <button class="btn block accent" type="submit">${icons.check} ${onboarding ? 'Calculate My Targets & Start' : 'Save Profile'}</button>
          </form>
        </div>
        <br/>
        <div class="card">
          <h3>${icons.flame} Live Target Preview</h3>
          <div class="field"><label>Diet / Macro plan</label>
            <select id="diet-select">
              ${DIET_OPTIONS.map(([v, l]) => `<option value="${v}" ${(p.diet_type ?? 'normal') === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
            <p class="form-hint">Pick your diet — macros below reshape instantly. Save the profile to apply it everywhere.</p>
          </div>
          <div id="pv" class="grid grid-c2"></div>
        </div>
        <br/>
        <div class="card">
          <h3>✈️ Telegram</h3>
          <p style="font-size:13px;color:var(--muted);margin-bottom:10px">
            Log meals by message! Generate a link code, then send
            <b>/link CODE</b> to your bot within 15 minutes.
          </p>
          <button class="btn sm accent" id="tg-link-btn">${icons.plus} Generate link code</button>
          <p class="form-hint" id="tg-code-out" style="margin-top:8px"></p>
        </div>
      </div>
    </div>`;
  const form = qs('#pf-form', root);
  const pv = qs('#pv', root);

  function refreshPreview() {
    const f = new FormData(form);
    const dietSel = qs('#diet-select', root);
    const dietInfo = DIET_OPTIONS.find(([v]) => v === dietSel.value) || DIET_OPTIONS[0];
    const vals = {
      age: Number(f.get('age')), height: Number(f.get('height_cm')),
      weight: Number(f.get('current_weight')), gender: f.get('gender'),
      activity: f.get('activity_level'), goal: f.get('goal_type'),
      weekly: Number(f.get('weekly_goal_kg')), diet: dietSel.value,
    };
    if (![vals.age, vals.height, vals.weight].every(Number.isFinite) || !(vals.age > 0)) {
      pv.innerHTML = '<div class="empty">Fill in your age, height &amp; weight to see targets.</div>';
      return;
    }
    const t = preview(vals);
    pv.innerHTML = `
      <div><b>BMR:</b> ${fmt(t.bmr)} kcal · <b>TDEE:</b> ${fmt(t.tdee)} kcal</div>
      <div><b>BMI:</b> ${t.bmi} (${bmiCat(t.bmi)})</div>
      <div><b>Daily calories:</b> ${fmt(t.calTarget)} kcal <span style="color:var(--muted)">(${t.weekly === 0 ? 'maintain' : `${t.weekly > 0 ? '+' : ''}${t.weekly} kg/wk`})</span></div>
      <div><b>Macros (${esc(dietInfo[1])}):</b> P ${fmt(t.protein)} g · C ${fmt(t.carbs)} g · F ${fmt(t.fat)} g
        <br/><span style="color:var(--muted);font-size:12px">${esc(dietInfo[2])}</span></div>`;
  }

  form.addEventListener('input', () => {
    const maintain = form.goal_type.value === 'maintain';
    form.weekly_goal_kg.disabled = maintain;
    qs('#weekly-label').textContent =
      `Target ${maintain ? '(not needed to maintain)' : form.goal_type.value === 'gain' ? 'gain per week (kg)' : 'loss per week (kg)'}`;
    refreshPreview();
  });
  qs('#diet-select', root).addEventListener('change', refreshPreview);
  refreshPreview();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    try {
      const data = await api.put('/api/profile', {
        name: String(f.get('name') || '').trim(),
        age: Number(f.get('age')),
        gender: f.get('gender'),
        height_cm: Number(f.get('height_cm')),
        activity_level: f.get('activity_level'),
        current_weight: Number(f.get('current_weight')),
        goal_type: f.get('goal_type'),
        weekly_goal_kg: Number(f.get('weekly_goal_kg')) || 0,
        step_goal: Number(f.get('step_goal')),
        diet_type: qs('#diet-select', root).value,
        today: todayStr(),
      });
      App.profile = data.profile;
      toast(onboarding ? 'Profile ready — welcome aboard!' : 'Profile updated');
      location.hash = '#/dashboard';
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Telegram linking — generate a one-time code bound to THIS logged-in account.
  qs('#tg-link-btn', root).addEventListener('click', async () => {
    const out = qs('#tg-code-out', root);
    try {
      const r = await api.post('/api/telegram/link-code');
      out.innerHTML =
        `Your code: <b style="font-size:18px;letter-spacing:2px">${esc(r.code)}</b><br/>` +
        `In Telegram, send your bot: <b>/link ${esc(r.code)}</b> (valid ${r.expires_in_minutes} min).`;
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

