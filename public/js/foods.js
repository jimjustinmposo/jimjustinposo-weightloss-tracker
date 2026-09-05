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
/* ---------- "Paste food details" auto-fill for the Add New Food form ---------- */
/* Accepts copy-pasted nutrition info in common formats, e.g.
     Sinigang
     Calories: 95 kcal
     Protein: 10 g
     Carbs: 7 g
     Fat: 3 g
   Labels are matched case-insensitively anywhere in the text; the number that
   follows each label is placed into the matching form field below. */
function parseFoodText(text) {
  const src = String(text || '');
  const lines = src.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  // First number that follows a label, e.g. "Protein: 10 g" → 10.
  const grab = (aliases) => {
    const re = new RegExp(`\\b(?:${aliases.join('|')})\\b[^\\d\\r\\n]{0,40}(\\d+(?:\\.\\d+)?)`, 'i');
    const m = src.match(re);
    return m ? Number(m[1]) : null;
  };

  // Food name: an explicit "Name: ..." line, else the first line that isn't a
  // nutrition label (e.g. "Sinigang").
  let name = null;
  const namedLine = lines.find((l) => /^name\s*[:=\-–]\s*/i.test(l));
  if (namedLine) name = namedLine.replace(/^name\s*[:=\-–]\s*/i, '').trim();
  if (!name) {
    const skipRe = /\b(calories?|kcal|protein|carbs?|carbohydrates?|fat|energy|servings?|per\s*\d+\s*g)\b/i;
    const candidate = lines.find((l) => !skipRe.test(l));
    if (candidate) {
      // Strip a leading weight token ("300g chicken breast" → "chicken breast"),
      // then any bullet/ordered-list marker ("1. Chicken" → "Chicken").
      name = candidate
        .replace(/^\s*\d+(?:\.\d+)?\s*(?:kg|kgs|kilograms?|kilos?|g|grams?|gr|gm)\b/gi, '')
        .replace(/^[-•*>\d.]+\s*/, '')
        .trim();
    }
  }
  if (!name) name = lines[0];
  // Drop any weight amount from the name (e.g. "Sinigang 250g" → "Sinigang").
  name = String(name)
    .replace(/\b\d+(?:\.\d+)?\s*(?:kg|kgs|kilograms?|kilos?|g|grams?|gr|gm)\b/gi, '')
    .replace(/[:;*\s]+$/, '')
    .trim()
    .slice(0, 120);

  // Calories may appear as "Calories: 95 kcal" or just "95 kcal".
  const kcalLabel = src.match(/\b(?:calories?|energy)\b[^\d\n]{0,40}(\d+(?:\.\d+)?)/i);
  const kcalUnit = src.match(/\b(\d+(?:\.\d+)?)\s*kcal\b/i);

  // Optional serving size, e.g. "Serving: 250 g" → 250.
  const serving = src.match(/\bservings?\b[^\d\n]{0,30}?(\d+(?:\.\d+)?)\s*(?:g|grams?)\b/i);

  // Plain weight amount outside any nutrition line — "250g" or "Sinigang 250 g".
  // Used to auto-compute macros from the catalog and to fill the Serving (g) field.
  let grams = null;
  for (const line of lines) {
    if (/\b(calories?|kcal|protein|carbs?|carbohydrates?|fat|energy|sugars?|fiber)\b/i.test(line)) continue;
    const m = line.match(/\b(\d+(?:\.\d+)?)\s*(kg|kgs|kilograms?|kilos?|g|grams?|gr|gm)\b/i);
    if (m) {
      // kg / kilo / kgs → convert to grams (1 kg = 1000 g).
      grams = m[2][0].toLowerCase() === 'k' ? Number(m[1]) * 1000 : Number(m[1]);
      break;
    }
  }

  return {
    name,
    serving_grams: serving ? Number(serving[1]) : null,
    grams,
    calories: kcalLabel ? Number(kcalLabel[1]) : (kcalUnit ? Number(kcalUnit[1]) : null),
    protein: grab(['protein']),
    carbs: grab(['carbs?', 'carbohydrates?']),
    fat: grab(['fat']),
  };
}

/* Round to 2 decimals for values placed into the form. */
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/* Downscale a photo File to a JPEG data URL before sending it to the AI —
   phone camera photos can be several MB; the model only needs enough detail
   to identify the dish, so this keeps the upload small and fast. */
function resizeImageToDataUrl(file, maxDim = 1024, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
    img.src = url;
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
    <section class="grid grid-auto foods-layout">
      <div class="card">
        <h3>${icons.search} My Foods</h3>
        <div class="searchbox">${icons.search}
          <input type="text" id="fm-q" placeholder="Search foods…" autocomplete="off" /></div>
        <div id="fm-list"><div class="empty">Loading…</div></div>
      </div>
      <div class="card">
        <h3>${icons.plus} Add New Food</h3>
        <div class="paste-box">
          <label for="fm-parse-input">Paste food details to auto-fill the form below:</label>
          <textarea id="fm-parse-input" rows="5" spellcheck="false" placeholder="Sinigang 250 g&#10;… or paste full labels:&#10;Sinigang&#10;Calories: 95 kcal&#10;Protein: 10 g&#10;Carbs: 7 g&#10;Fat: 3 g"></textarea>
          <div class="paste-actions">
            <button type="button" id="fm-parse-btn" class="btn sm">${icons.search} Fill form from text</button>
            <button type="button" id="fm-parse-clear" class="btn sm ghost">Clear</button>
          </div>
          <div id="fm-parse-note" class="form-hint">Type just a food + amount (e.g. “Sinigang 250 g”) to auto-compute macros from your food database — or paste full nutrition labels. Review, then click “Add to Database”.</div>
        </div>
        <div class="photo-box">
          <label for="fm-photo-input">Or identify from a photo:</label>
          <div class="photo-row">
            <input type="file" id="fm-photo-input" accept="image/*" capture="environment" />
            <img id="fm-photo-preview" class="photo-preview" alt="" />
          </div>
          <div class="photo-row">
            <input type="text" id="fm-photo-name" placeholder="Food name (optional, e.g. Sinigang na Baboy)" />
            <input type="number" id="fm-photo-grams" placeholder="Grams e.g. 300" min="1" max="5000" step="1" />
          </div>
          <div class="photo-actions">
            <button type="button" id="fm-photo-btn" class="btn sm">${icons.camera} Identify with Gemini</button>
            <button type="button" id="fm-photo-clear" class="btn sm ghost">Clear</button>
          </div>
          <div id="fm-photo-note" class="form-hint">Take or choose a photo, optionally add the food name and grams, then tap “Identify with Gemini” to fill the fields below.</div>
        </div>
        <hr class="paste-sep" />
        <form id="fm-add">
          <div class="field"><label>Food name</label>
            <input name="name" placeholder="e.g. Chicken breast raw" required /></div>
          <div class="form-row">
            <div class="field"><label>Serving (g)</label>
              <input name="serving_grams" type="number" step="any" min="1" value="100" required /></div>
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
  const addForm = qs('#fm-add', root);
  const parseInput = qs('#fm-parse-input', root);
  const parseNote = qs('#fm-parse-note', root);

  // ---- Paste-to-fill: turn pasted text into the form fields ----
  //  • name + amount  → look the food up in the catalog; if not found, get an ONLINE
  //    estimate (ranges always use the MAX, e.g. protein 10–13 g → 13 g)
  //  • name only (no amount) → online estimate for the default 100 g serving
  //  • full nutrition labels → put each detected value into its matching field
  const fillBtn = qs('#fm-parse-btn', root);
  const fillBtnOriginal = fillBtn.innerHTML;
  const setBusy = (busy) => {
    fillBtn.disabled = busy;
    fillBtn.innerHTML = busy ? 'Estimating…' : fillBtnOriginal;
  };

  qs('#fm-parse-btn', root).addEventListener('click', async () => {
    const p = parseFoodText(parseInput.value);
    if (!p || (!p.name && p.calories == null && p.protein == null && p.carbs == null && p.fat == null)) {
      parseNote.textContent = '';
      toast('Could not detect any food details — check the pasted text and try again.', 'error');
      return;
    }
    const e = addForm.elements;
    const hasLabels = p.calories != null || p.protein != null || p.carbs != null || p.fat != null;

    // Name given (with or without an amount) → catalog first, online estimate next.
    if (p.name && !hasLabels) {
      const estimateGrams = p.grams || 100; // no amount typed → estimate the default 100 g serving
      let matched = null;
      try {
        const data = await api.get(`/api/foods?q=${encodeURIComponent(p.name)}`);
        const exact = data.foods.find((f) => f.name.trim().toLowerCase() === p.name.trim().toLowerCase());
        matched = exact || (data.foods.length === 1 ? data.foods[0] : null);
      } catch { /* ignore → fall through to the online estimate below */ }

      if (matched) {
        const k = estimateGrams / 100;
        const scale = (v) => round2(Number(v) * k);
        e.name.value = matched.name;
        e.serving_grams.value = estimateGrams;
        e.calories.value = scale(matched.calories_per_100g);
        e.protein.value = scale(matched.protein_per_100g);
        e.carbs.value = scale(matched.carbs_per_100g);
        e.fat.value = scale(matched.fat_per_100g);
        parseNote.textContent =
          `Matched “${matched.name}” — macros computed for ${fmt(estimateGrams)} g from its per-100 g profile (${fmt(matched.calories_per_100g)} kcal/100 g).`;
        toast(`Filled from “${matched.name}” — ${fmt(estimateGrams)} g × per-100 g macros`);
        return;
      }

      // Not found in the local database → ONLINE estimate, max of any range.
      setBusy(true);
      try {
        const { estimate } = await api.post('/api/nutrition/estimate', { name: p.name, grams: estimateGrams });
        e.name.value = estimate.name || p.name;
        e.serving_grams.value = estimateGrams;
        e.calories.value = estimate.calories;
        e.protein.value = estimate.protein;
        e.carbs.value = estimate.carbs;
        e.fat.value = estimate.fat;
        parseNote.textContent =
          `“${estimate.name || p.name}” isn’t in your database — the macros above are an ONLINE ESTIMATE for ${fmt(estimateGrams)} g. Ranges always take the max (e.g. protein 10–13 g → 13 g). Review before adding.`;
        toast(`Online estimate filled for “${estimate.name || p.name}” — max of ranges used`);
      } catch (err) {
        // No online source available — leave the name + serving and let the
        // user fill the macros manually (or paste full nutrition labels).
        const reason = err?.message || String(err);
        let hint = 'Set AI_BASE_URL + AI_MODEL (.dev.vars) and start your AI server.';
        if (err?.status === 503) hint = 'AI not configured — add AI_BASE_URL + AI_MODEL and start your AI server.';
        else if (err?.status === 502) hint = 'AI request failed — check your AI endpoint and model name.';
        e.name.value = p.name;
        if (p.grams) e.serving_grams.value = p.grams;
        parseNote.textContent =
          `“${p.name}” — online estimate unavailable (${reason}). ${hint} Macros left blank; fill them below or paste full nutrition labels.`;
        toast(`Online estimate unavailable — ${hint}`, 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    // Full-label format: put each detected value into its matching field.
    if (p.name) e.name.value = p.name;
    const serving = p.serving_grams != null ? p.serving_grams : p.grams;
    if (serving != null) e.serving_grams.value = serving;
    if (p.calories != null) e.calories.value = p.calories;
    if (p.protein != null) e.protein.value = p.protein;
    if (p.carbs != null) e.carbs.value = p.carbs;
    if (p.fat != null) e.fat.value = p.fat;

    const labels = { name: 'Name', serving_grams: 'Serving', calories: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
    const got = Object.keys(labels).filter((k) =>
      k === 'name' ? !!p.name : (k === 'serving_grams' ? serving != null : p[k] != null));
    parseNote.textContent = `Filled ${got.map((k) => labels[k]).join(', ') || 'no fields'} — review, then click “Add to Database”.`;
    toast(`Form filled from text — ${got.length}/6 fields detected`);
  });

  qs('#fm-parse-clear', root).addEventListener('click', () => {
    parseInput.value = '';
    parseNote.textContent = '';
    addForm.reset();
    parseInput.focus();
  });

  // ---- Photo-to-fill: snap/choose a photo, identify the food with Gemini ----
  const photoInput = qs('#fm-photo-input', root);
  const photoPreview = qs('#fm-photo-preview', root);
  const photoNameInput = qs('#fm-photo-name', root);
  const photoGramsInput = qs('#fm-photo-grams', root);
  const photoBtn = qs('#fm-photo-btn', root);
  const photoBtnOriginal = photoBtn.innerHTML;
  const photoNote = qs('#fm-photo-note', root);
  let photoDataUrl = null;

  const setPhotoBusy = (busy) => {
    photoBtn.disabled = busy;
    photoBtn.innerHTML = busy ? 'Identifying…' : photoBtnOriginal;
  };

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    try {
      photoDataUrl = await resizeImageToDataUrl(file);
      photoPreview.src = photoDataUrl;
      photoPreview.classList.add('show');
      photoNote.textContent = 'Photo ready — add a name/grams if you like, then tap “Identify with Gemini”.';
    } catch {
      photoDataUrl = null;
      toast('Could not read that photo — try another one.', 'error');
    }
  });

  photoBtn.addEventListener('click', async () => {
    if (!photoDataUrl) {
      toast('Choose or take a photo first.', 'error');
      return;
    }
    const name = photoNameInput.value.trim();
    const gramsTyped = Number(photoGramsInput.value);
    const grams = Number.isFinite(gramsTyped) && gramsTyped > 0 ? gramsTyped : 100;
    const e = addForm.elements;

    setPhotoBusy(true);
    try {
      const { estimate } = await api.post('/api/nutrition/estimate', { name, grams, image: photoDataUrl });
      e.name.value = estimate.name || name || 'Identified food';
      e.serving_grams.value = grams;
      e.calories.value = estimate.calories;
      e.protein.value = estimate.protein;
      e.carbs.value = estimate.carbs;
      e.fat.value = estimate.fat;
      photoNote.textContent =
        `Identified “${estimate.name}” from your photo — macros are an ONLINE ESTIMATE for ${fmt(grams)} g${Number.isFinite(gramsTyped) && gramsTyped > 0 ? '' : ' (default, no grams typed)'}. Review before adding.`;
      toast(`Identified “${estimate.name}” from photo`);
    } catch (err) {
      const reason = err?.message || String(err);
      let hint = 'Set AI_BASE_URL + AI_MODEL (.dev.vars) to a vision-capable model (e.g. Gemini).';
      if (err?.status === 503) hint = 'AI not configured — add AI_BASE_URL + AI_MODEL and start your AI server.';
      else if (err?.status === 502) hint = 'AI request failed — check your AI endpoint/model, and that it supports image input.';
      photoNote.textContent = `Could not identify the food from the photo (${reason}). ${hint}`;
      toast(`Photo identification failed — ${hint}`, 'error');
    } finally {
      setPhotoBusy(false);
    }
  });

  qs('#fm-photo-clear', root).addEventListener('click', () => {
    photoInput.value = '';
    photoDataUrl = null;
    photoPreview.src = '';
    photoPreview.classList.remove('show');
    photoNameInput.value = '';
    photoGramsInput.value = '';
    photoNote.textContent = 'Take or choose a photo, optionally add the food name and grams, then tap “Identify with Gemini” to fill the fields below.';
  });

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
      parseInput.value = '';
      parseNote.textContent = '';
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


