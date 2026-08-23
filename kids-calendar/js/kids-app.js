/**
 * Kids view-only app.
 *
 * Security rules (do not relax):
 * - Unwrap ONLY config.kidsCrypto. Never read or decrypt the family write blob.
 * - Family / admin password must fail here unless it happens to match the kids password.
 * - GitHub access is GET-only. This path never writes files and never loads a write token.
 */
(function () {
  'use strict';

  const SESSION_KEY = 'custodyCalendar.kids.session.v1';
  const REMEMBER_KEY = 'custodyCalendar.kids.remember.v1';
  const AUTO_REFRESH_MS = 60 * 1000;

  const $ = (id) => document.getElementById(id);

  let config = null;
  let readToken = null;
  let refreshTimer = null;
  const view = CustodyKidsView.create({ viewKey: 'custodyCalendar.kids.view.v1' });

  function showStatus(msg, kind) {
    const el = $('statusBanner');
    el.textContent = msg || '';
    el.classList.remove('error', 'ok', 'warn', 'show');
    if (!msg) return;
    if (kind) el.classList.add(kind);
    el.classList.add('show');
  }

  function storeSession(token, remember) {
    const payload = JSON.stringify({ token, at: Date.now() });
    sessionStorage.setItem(SESSION_KEY, payload);
    if (remember) localStorage.setItem(REMEMBER_KEY, payload);
    else localStorage.removeItem(REMEMBER_KEY);
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(REMEMBER_KEY);
    readToken = null;
  }

  function readStoredSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(REMEMBER_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.token ? parsed.token : null;
    } catch {
      return null;
    }
  }

  function b64DecodeUnicode(str) {
    return decodeURIComponent(escape(atob(str)));
  }

  async function getFile(path) {
    if (!readToken) throw new Error('Not unlocked');
    const apiPath =
      `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}` +
      `/contents/${path.split('/').map(encodeURIComponent).join('/')}` +
      `?ref=${encodeURIComponent(config.branch || 'main')}`;
    const res = await fetch('https://api.github.com' + apiPath, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${readToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Could not load schedule (${res.status}).`);
    const json = await res.json();
    return { sha: json.sha, content: b64DecodeUnicode(json.content.replace(/\n/g, '')) };
  }

  async function loadTusdCalendar() {
    try {
      const res = await fetch('data/tusd-calendar.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('missing');
      view.setTusdCal(await res.json());
    } catch (e) {
      console.warn(e);
      view.setTusdCal(null);
    }
  }

  async function loadSchedule(opts) {
    const quiet = opts && opts.quiet;
    if (!quiet) showStatus('Loading schedule…');
    try {
      const file = await getFile(config.dataPath || 'custody_data.json');
      if (!file) {
        view.setData(view.defaultData());
        if (!quiet) showStatus('No schedule yet.', 'warn');
      } else {
        view.setData(JSON.parse(file.content));
        if (!quiet) showStatus('');
      }
      view.renderAll();
      $('lastUpdated').textContent = view.formatUpdated(view.getUpdatedAt());
    } catch (err) {
      console.error(err);
      if (!quiet) showStatus(err.message || String(err), 'error');
    }
  }

  function startRefresh() {
    view.startClock();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (!readToken) return;
      loadSchedule({ quiet: true });
    }, AUTO_REFRESH_MS);
  }

  function stopRefresh() {
    view.stopClock();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
  }

  function showApp() {
    $('lockScreen').classList.add('hidden');
    $('appShell').classList.add('show');
    document.body.classList.add('app-unlocked', 'kiosk-mode');
    $('trustBanner').textContent = 'Kids view — look only. Parents update the shared schedule.';
    $('trustBanner').classList.add('show', 'kiosk');
    $('brandKicker').textContent = 'Kids view';
    view.applyParentCss();
    view.initNav();
    startRefresh();
    loadSchedule();
  }

  function showLock() {
    stopRefresh();
    $('appShell').classList.remove('show');
    document.body.classList.remove('app-unlocked');
    $('lockScreen').classList.remove('hidden');
    $('kidsPassword').value = '';
    $('lockError').classList.remove('show');
  }

  function openMenu() {
    $('menuModal').classList.add('show');
  }
  function closeMenu() {
    $('menuModal').classList.remove('show');
  }

  function lockNow() {
    clearSession();
    closeMenu();
    showLock();
  }

  async function unlockWithKidsPassword(password, remember) {
    if (!CustodyCrypto.isKidsConfigured(config)) {
      throw new Error('Kids view isn’t set up yet');
    }
    // Intentionally kidsCrypto only — family crypto is never passed here.
    const token = await CustodyCrypto.decryptToken(password, config.kidsCrypto);
    readToken = token;
    storeSession(token, remember);
    $('lockError').classList.remove('show');
    showApp();
  }

  async function init() {
    try {
      const res = await fetch('config.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('config missing');
      config = await res.json();
    } catch {
      config = null;
    }

    await loadTusdCalendar();

    if (config && config.appTitle) {
      $('lockTitle').textContent = config.appTitle;
      $('appTitle').textContent = config.appTitle;
      document.title = config.appTitle + ' — Kids';
    }

    if (!CustodyCrypto.isKidsConfigured(config)) {
      $('setupNeeded').classList.add('show');
      $('unlockBtn').disabled = true;
      $('kidsPassword').disabled = true;
      $('rememberRow').style.opacity = '0.45';
      $('lockSub').textContent =
        'Kids view isn’t set up yet. A parent needs to add a kids password in setup (locally), then copy the new config.json to Pages.';
      return;
    }

    const stored = readStoredSession();
    if (stored) {
      readToken = stored;
      showApp();
    }
  }

  $('lockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!CustodyCrypto.isKidsConfigured(config)) {
      $('lockError').textContent = 'Kids view isn’t set up yet.';
      $('lockError').classList.add('show');
      return;
    }
    const password = $('kidsPassword').value;
    if (!password) {
      $('lockError').textContent = 'Enter the kids password.';
      $('lockError').classList.add('show');
      return;
    }
    const btn = $('unlockBtn');
    btn.disabled = true;
    btn.textContent = 'Opening…';
    $('lockError').classList.remove('show');
    try {
      await unlockWithKidsPassword(password, $('rememberDevice').checked);
    } catch (err) {
      $('lockError').textContent =
        err.message === 'Wrong password' ? 'Wrong password. Try the kids password.' : err.message || 'Could not unlock.';
      $('lockError').classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Open kids calendar';
    }
  });

  document.querySelectorAll('.view-switch button').forEach((b) => {
    b.addEventListener('click', () => view.setViewMode(b.dataset.view));
  });

  $('prevRange').addEventListener('click', () => view.shiftRange(-1));
  $('nextRange').addEventListener('click', () => view.shiftRange(1));
  $('todayBtn').addEventListener('click', () => view.jumpToToday());
  $('reloadBtn').addEventListener('click', () => loadSchedule());
  $('menuBtn').addEventListener('click', openMenu);
  $('menuClose').addEventListener('click', closeMenu);
  $('menuModal').addEventListener('click', (e) => {
    if (e.target === $('menuModal')) closeMenu();
  });
  $('lockNowBtn').addEventListener('click', lockNow);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && readToken) {
      loadSchedule({ quiet: true });
      view.tickClock();
    }
  });

  init();
})();
