import api from './api.js';
import { App, profileComplete } from './state.js';
import { icons, toast, esc, qs } from './util.js';
import { renderDashboard } from './dashboard.js';
import { renderFoodsPage } from './foods.js';
import { renderHistory } from './history.js';
import { renderProfilePage } from './profile.js';

const view = () => document.getElementById('view');
const shell = () => document.getElementById('shell');

const NAV = [
  { hash: '#/dashboard', label: 'Dashboard', icon: 'home' },
  { hash: '#/foods', label: 'Foods', icon: 'utensils' },
  { hash: '#/history', label: 'History', icon: 'chart' },
  { hash: '#/profile', label: 'Profile', icon: 'user' },
];

function buildShell() {
  if (shell().dataset.built) return;
  const name = App.user?.name || App.user?.email?.split('@')[0] || '';
  shell().innerHTML = `
    <header class="topbar">
      <div class="brand">${icons.heart}<span>Develop by Jim Justin Poso<small>Weightloss Tracker</small></span></div>
      <nav class="topnav">
        ${NAV.map((n) => `<a href="${n.hash}" data-nav="${n.hash}">${n.label}</a>`).join('')}
      </nav>
      <div class="spacer"></div>
      <div class="userchip">
        <div class="avatar">${icons.user}</div>
        <span class="uname" title="${esc(App.user?.email || '')}">${esc(name)}</span>
        <button class="icon-btn" id="logout-btn" title="Log out">${icons.logout}</button>
      </div>
    </header>
    <nav class="bottomnav">
      ${NAV.map((n) => `<a href="${n.hash}" data-nav="${n.hash}">${icons[n.icon]}<span>${n.label}</span></a>`).join('')}
    </nav>`;
  shell().dataset.built = '1';
  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await api.post('/api/auth/logout');
    } catch { /* ignore */ }
    App.user = null;
    App.profile = null;
    delete shell().dataset.built;
    shell().innerHTML = '';
    location.hash = '#/login';
  });
}

function markActive() {
  const h = location.hash || '#/dashboard';
  // Treat onboarding as the Profile page for nav highlighting.
  const active = h === '#/onboarding' ? '#/profile' : h;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === active);
  });
}

/* ---------------- Auth views ---------------- */
function brandHtml(title, sub) {
  return `
    <div class="auth-brand">
      <div class="logo">${icons.heart}</div>
      <h1>${title}</h1>
      <p>${sub}</p>
    </div>`;
}

function renderLogin() {
  shell().innerHTML = '';
  delete shell().dataset.built;
  view().innerHTML = `
    <div class="auth-wrap"><div class="auth-card"><div class="card">
      ${brandHtml('Welcome back', 'Sign in to continue your journey')}
      <form id="login-form" novalidate>
        <div class="form-error" id="err"></div>
        <div class="field"><label>Email</label>
          <input type="email" name="email" placeholder="you@example.com" autocomplete="email" required /></div>
        <div class="field"><label>Password</label>
          <input type="password" name="password" placeholder="••••••••" autocomplete="current-password" required /></div>
        <button class="btn block" type="submit">Sign In</button>
      </form>
      <p class="auth-alt">New here? <a href="#/register">Create an account</a></p>
    </div></div></div>`;
  qs('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const errEl = qs('#err');
    errEl.classList.remove('show');
    try {
      const data = await api.post('/api/auth/login', { email: f.email.value.trim(), password: f.password.value });
      App.user = data.user;
      App.profile = data.profile;
      location.hash = profileComplete(App.profile) ? '#/dashboard' : '#/onboarding';
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
    }
  });
}

function renderRegister() {
  shell().innerHTML = '';
  delete shell().dataset.built;
  view().innerHTML = `
    <div class="auth-wrap"><div class="auth-card"><div class="card">
      ${brandHtml('Create your account', 'Start tracking weight, food & steps today')}
      <form id="reg-form" novalidate>
        <div class="form-error" id="err"></div>
        <div class="field"><label>Name</label>
          <input type="text" name="name" placeholder="Justin Poso" autocomplete="name" /></div>
        <div class="field"><label>Email</label>
          <input type="email" name="email" placeholder="you@example.com" autocomplete="email" required /></div>
        <div class="field"><label>Password (min 6 chars)</label>
          <input type="password" name="password" placeholder="••••••••" autocomplete="new-password" minlength="6" required /></div>
        <button class="btn block accent" type="submit">Create Account</button>
      </form>
      <p class="auth-alt">Already have an account? <a href="#/login">Sign in</a></p>
    </div></div></div>`;
  qs('#reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const errEl = qs('#err');
    errEl.classList.remove('show');
    try {
      const data = await api.post('/api/auth/register', {
        name: f.name.value.trim(),
        email: f.email.value.trim(),
        password: f.password.value,
      });
      App.user = data.user;
      App.profile = data.profile;
      location.hash = '#/onboarding';
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('show');
    }
  });
}
/* ---------------- Router ---------------- */
const routes = {
  '#/dashboard': renderDashboard,
  '#/foods': renderFoodsPage,
  '#/history': renderHistory,
  '#/profile': renderProfilePage,
  '#/onboarding': renderProfilePage,
};

async function route() {
  const hash = location.hash || '#/dashboard';

  // Unauthenticated users only see auth screens.
  if (!App.user) {
    if (hash === '#/register') return renderRegister();
    return renderLogin();
  }

  if (hash === '#/login' || hash === '#/register') {
    location.hash = profileComplete(App.profile) ? '#/dashboard' : '#/onboarding';
    return;
  }

  // First-run: force profile setup.
  if (!profileComplete(App.profile) && hash !== '#/onboarding') {
    location.hash = '#/onboarding';
    return;
  }

  buildShell();
  markActive();

  const handler = routes[hash] || renderDashboard;
  try {
    await handler(view());
  } catch (err) {
    console.error(err);
    view().innerHTML = `<div class="card"><div class="empty">${icons.alert}
      <p>${esc(err.message || 'Something went wrong.')}</p></div></div>`;
    toast(err.message || 'Something went wrong.', 'error');
  }
}

async function boot() {
  try {
    const data = await api.get('/api/auth/me');
    App.user = data.user;
    App.profile = data.profile;
  } catch {
    App.user = null;
  }
  window.addEventListener('hashchange', route);
  await route();
}

boot();

