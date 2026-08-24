import api from './api.js';
import { App } from './state.js';
import { icons, fmt, esc, toast, openModal, todayStr, qs, qsa, debounce } from './util.js';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];

function mealOptions(selected = 'lunch') {
  return MEALS.map((m) => `<option value="${m}" ${m === selected ? 'selected' : ''}>${m[0].toUpperCase() + m.slice(1)}</option>`).join('');
}

/* ---------- Shared "Log Food" modal: search catalog → add to a day ---------- */
export function foodPickerModal(onDone) {
  const { overlay } = openModal({
    title: 'Log Food',
    body: `
      <div class="searchbox">${icons.search}
        <input type="text" id="fp-q" placeholder="Search your foods… e.g. chicken breast" autocomplete="off" />
      </div>
      <div id="fp-results"><div class="empty">${icons.utensils}<p>Type to search your food database.<br/>Not found? Create it below.</p></div></div>
      <details id="fp-create" style="margin-top:14px">
        <summary style="cursor:pointer;font-weight:700;color:var(--primary);font-size:13.5px;padding:8px 0">
          + Create new food
        </summary>
        <form id="fp-create-form" style="margin-top:10px;background:var(--bg);padding:14px;border-radius:12px">
          <div class="field"><label>Food name</label><input name="name" placeholder="e.g. Chicken breast raw" required /></div>
          <div class="form-row">
            <div class="field"><label>Serving (g)</label><input name="serving_grams" type="number" step="1" min="1" value="100" required /></div>
            <div class="field"><label>Calories (this serving)</label><input name="calories" type="number" step="0.1" min="0" placeholder="165" required /></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Protein g</label><input name="protein" type="number" step="0.1" min="0" placeholder="31" /></div>
            <div class="field"><label>Carbs g</label><input name="carbs" type="number" step="0.1" min="0" placeholder="0" /></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Fat g</label><input name="fat" type="number" step="0.1" min="0" placeholder="3.6" /></div>
            <div class="field" style="align-self:end"><label>&nbsp;</label>
              <button class="btn accent block" type="submit">${icons.plus} Save to My Foods</button></div>
          </div>
        </form>
      </details>`,
  });

  const resultsEl = qs('#fp-results', overlay);
  const input = qs('#fp-q', overlay);
  async function search() {
    const q = input.value.trim();
    if (!q) {
      resultsEl.innerHTML = `<div class="empty">${icons.utensils}<p>Type to search your food database.</p></div>`;
      return;
    }
    resultsEl.innerHTML = '<div class="empty">Searching…</div>';
    try {
      const data = await api.get(`/api/foods?q=${encodeURIComponent(q)}`);
      if (!data.foods.length) {
        resultsEl.innerHTML = `<div class="empty">${icons.search}<p>No match for “${esc(q)}”.<br/>Create it in “Create new food” below.</p></div>`;
        return;
      }
      resultsEl.innerHTML = data.foods.map((f) => `
        <details class="day" style="border-bottom:none">
          <summary style="padding:10px 2px">
            <span class="grow" style="flex:1">
              <span class="title" style="display:block;font-weight:700;font-size:14px">${esc(f.name)}</span>
              <span class="meta" style="font-size:11.5px;color:var(--muted)">
                ${fmt(f.calories_per_100g)} kcal/100g · P ${fmt(f.protein_per_100g, 1)} C ${fmt(f.carbs_per_100g, 1)} F ${fmt(f.fat_per_100g, 1)}
              </span>
            </span>${icons.chevD}
          </summary>
          <form class="fp-add" data-id="${f.id}" data-name="${esc(f.name)}" style="padding:2px 2px 14px">
            <div class="result-gram">
              <input type="number" name="grams" min="1" max="5000" step="1" value="${Math.round(Number(f.serving_grams) || 100)}" required />
              <span style="font-size:12px;color:var(--muted)">grams of</span>
              <select name="meal">${mealOptions()}</select>
              <button class="btn sm accent" type="submit">Add</button>
            </div>
            <div class="fp-preview form-hint"></div>
          </form>
        </details>`).join('');

      qsa('.fp-add', resultsEl).forEach((form) => {
        const food = data.foods.find((x) => String(x.id) === form.dataset.id);
        wireAddForm(form, food, onDone);
      });
    } catch (err) {
      resultsEl.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  input.addEventListener('input', debounce(search, 280));

  qs('#fp-create-form', overlay).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api.post('/api/foods', {
        name: f.name.value.trim(),
        serving_grams: Number(f.serving_grams.value),
        calories: Number(f.calories.value),
        protein: Number(f.protein.value || 0),
        carbs: Number(f.carbs.value || 0),
        fat: Number(f.fat.value || 0),
      });
      toast(`${f.name.value.trim()} saved to your foods`);
      f.reset();
      input.value = '';
      search();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  setTimeout(() => input.focus(), 60);
}

function wireAddForm(form, food, onDone) {
  const gramsInput = form.querySelector('input[name=grams]');
  const preview = form.querySelector('.fp-preview');
  const update = () => {
    const k = (Number(gramsInput.value) || 0) / 100;
    preview.textContent = `= ${fmt(Number(food.calories_per_100g) * k)} kcal · P ${fmt(Number(food.protein_per_100g) * k, 1)}g · C ${fmt(Number(food.carbs_per_100g) * k, 1)}g · F ${fmt(Number(food.fat_per_100g) * k, 1)}g`;
  };
  gramsInput.addEventListener('input', update);
  update();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/logs', {
        date: App.date,
        meal: form.querySelector('select').value,
        grams: Number(gramsInput.value),
        food_id: Number(form.dataset.id),
      });
      toast(`Added ${form.dataset.name}`);
      onDone?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
/* ---------- Foods management page ---------- */
export async function renderFoodsPage(root) {
  root.innerHTML = `
    <div class="page-title">
      <div><h2>Food Intake Database</h2>
        <p>Your personal food catalog — search it every time you log a meal, add new foods anytime.</p></div>
      <button class="btn" id="foods-log">${icons.plus} Log Food</button>
    </div>
    <section class="grid grid-auto">
      <div class="card">
        <h3>${icons.search} My Foods</h3>
        <div class="searchbox">${icons.search}
          <input type="text" id="fm-q" placeholder="Search foods…" autocomplete="off" /></div>
        <div id="fm-list"><div class="empty">Loading…</div></div>
      </div>
      <div class="card">
        <h3>${icons.plus} Add New Food</h3>
        <form id="fm-add">
          <div class="field"><label>Food name</label>
            <input name="name" placeholder="e.g. Chicken breast raw" required /></div>
          <div class="form-row">
            <div class="field"><label>Serving (g)</label>
              <input name="serving_grams" type="number" step="1" min="1" value="100" required /></div>
            <div class="field"><label>Calories (this serving)</label>
              <input name="calories" type="number" step="0.1" min="0" placeholder="165" required /></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Protein g</label><input name="protein" type="number" step="0.1" min="0" placeholder="31" /></div>
            <div class="field"><label>Carbs g</label><input name="carbs" type="number" step="0.1" min="0" placeholder="0" /></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Fat g</label><input name="fat" type="number" step="0.1" min="0" placeholder="3.6" /></div>
            <div class="field" style="align-self:end"><label>&nbsp;</label>
              <button class="btn accent block" type="submit">${icons.plus} Add to Database</button></div>
          </div>
          <p class="form-hint">Values are for the serving size entered — stored per 100 g so any amount can be logged.</p>
        </form>
      </div>
    </section>`;

  const listEl = qs('#fm-list', root);
  const qInput = qs('#fm-q', root);

  async function load() {
    const q = qInput.value.trim();
    try {
      const data = await api.get(`/api/foods${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      if (!data.foods.length) {
        listEl.innerHTML = `<div class="empty">${icons.utensils}<p>${q ? 'No matching foods.' : 'Your database is empty — add your first food!'}</p></div>`;
        return;
      }
      listEl.innerHTML = data.foods.map((f) => `
        <div class="lrow">
          <div class="grow">
            <div class="title">${esc(f.name)}</div>
            <div class="meta">per ${fmt(f.serving_grams)} g · ${fmt(f.calories_per_100g)} kcal/100g ·
              <span class="macro-mini"><b>P</b> ${fmt(f.protein_per_100g, 1)} <b>C</b> ${fmt(f.carbs_per_100g, 1)} <b>F</b> ${fmt(f.fat_per_100g, 1)}</span>
            </div>
          </div>
          <button class="icon-btn edit-food" data-id="${f.id}" title="Edit">${icons.pencil}</button>
          <button class="icon-btn del-food" data-id="${f.id}" title="Delete">${icons.trash}</button>
        </div>`).join('');

      qsa('.del-food', listEl).forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this food from your database? (Past diary entries are kept.)')) return;
          try {
            await api.del(`/api/foods/${btn.dataset.id}`);
            toast('Food deleted');
            load();
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );

      qsa('.edit-food', listEl).forEach((btn) =>
        btn.addEventListener('click', () => {
          const food = data.foods.find((x) => String(x.id) === btn.dataset.id);
          editModal(food, load);
        })
      );
    } catch (err) {
      listEl.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  qs('#fm-add', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api.post('/api/foods', {
        name: f.name.value.trim(),
        serving_grams: Number(f.serving_grams.value),
        calories: Number(f.calories.value),
        protein: Number(f.protein.value || 0),
        carbs: Number(f.carbs.value || 0),
        fat: Number(f.fat.value || 0),
      });
      toast('Food added');
      f.reset();
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  qs('#foods-log', root).addEventListener('click', () => foodPickerModal(null));
  qInput.addEventListener('input', debounce(load, 280));
  await load();
}
function editModal(food, onSaved) {
  const perServing = (per100) =>
    Math.round((((Number(per100) || 0) * Number(food.serving_grams)) / 100) * 10) / 10;
  const { overlay } = openModal({
    title: `Edit “${food.name}”`,
    body: `
      <form id="fe-form">
        <div class="field"><label>Food name</label><input name="name" value="${esc(food.name)}" required /></div>
        <div class="form-row">
          <div class="field"><label>Serving (g)</label>
            <input name="serving_grams" type="number" step="1" min="1" value="${Number(food.serving_grams)}" required /></div>
          <div class="field"><label>Calories (this serving)</label>
            <input name="calories" type="number" step="0.1" min="0" value="${perServing(food.calories_per_100g)}" required /></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Protein g</label><input name="protein" type="number" step="0.1" min="0" value="${perServing(food.protein_per_100g)}" /></div>
          <div class="field"><label>Carbs g</label><input name="carbs" type="number" step="0.1" min="0" value="${perServing(food.carbs_per_100g)}" /></div>
        </div>
        <div class="field"><label>Fat g</label><input name="fat" type="number" step="0.1" min="0" value="${perServing(food.fat_per_100g)}" /></div>
        <button class="btn block" type="submit">Save Changes</button>
      </form>`,
  });
  qs('#fe-form', overlay).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api.put(`/api/foods/${food.id}`, {
        name: f.name.value.trim(),
        serving_grams: Number(f.serving_grams.value),
        calories: Number(f.calories.value),
        protein: Number(f.protein.value || 0),
        carbs: Number(f.carbs.value || 0),
        fat: Number(f.fat.value || 0),
      });
      toast('Food updated');
      onSaved?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}


