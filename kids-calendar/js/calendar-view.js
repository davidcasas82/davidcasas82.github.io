/**
 * Read-only kids/kiosk calendar renderer.
 * No GitHub writes, no family token, no schedule mutation.
 */
(function (global) {
  'use strict';

  const LONG_VIEWS = new Set(['quarter', 'sixmonth', 'year']);
  const SCHOOL_HANDOFF = '15:00';
  const NOSCHOOL_HANDOFF = '12:00';

  function defaultData() {
    return {
      version: 1,
      updatedAt: null,
      parents: {
        mom: { label: "Mom's House", color: '#2f9e86' },
        dad: { label: "Dad's House", color: '#6b7cff' },
      },
      blocks: [],
      handoffs: {},
    };
  }

  function uid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : 'b-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function create(options) {
    options = options || {};
    const $ = (id) => document.getElementById(id);
    const viewKey = options.viewKey || 'custodyCalendar.kids.view.v1';

    let data = defaultData();
    let tusdCal = null;
    let noSchoolMap = new Map();
    let viewStart = startOfWeek(new Date());
    let viewMode = localStorage.getItem(viewKey) || 'week';
    let viewYear = new Date().getFullYear();
    let viewMonth = new Date().getMonth();
    let multiAnchor = new Date(viewYear, viewMonth, 1);
    let clockTimer = null;

    function startOfDay(d) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    function toISOFromDate(d) {
      return toISO(d.getFullYear(), d.getMonth(), d.getDate());
    }
    function toISO(y, m, day) {
      return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    function todayISO() {
      return toISOFromDate(new Date());
    }
    function parseISO(iso) {
      const [y, m, d] = iso.split('-').map(Number);
      return { y, m: m - 1, d };
    }
    function dateFromISO(iso) {
      const { y, m, d } = parseISO(iso);
      return new Date(y, m, d);
    }
    function addDaysISO(iso, n) {
      const dt = dateFromISO(iso);
      dt.setDate(dt.getDate() + n);
      return toISOFromDate(dt);
    }
    function addDaysDate(d, n) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    }
    function compareISO(a, b) {
      return a < b ? -1 : a > b ? 1 : 0;
    }
    function eachDate(start, end, fn) {
      let cur = start;
      while (compareISO(cur, end) <= 0) {
        fn(cur);
        cur = addDaysISO(cur, 1);
      }
    }
    function startOfWeek(d) {
      const x = startOfDay(d);
      x.setDate(x.getDate() - x.getDay());
      return x;
    }
    function shortLabel(label, fallback) {
      if (!label) return fallback;
      return label.replace(/'s House$/i, '').replace(/ House$/i, '').trim() || fallback;
    }
    function parentInitial(parent) {
      return parent === 'dad' ? 'D' : 'M';
    }
    function formatPretty(iso) {
      return dateFromISO(iso).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }

    function timeToMinutes(hhmm) {
      const parts = String(hhmm || '').split(':');
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
      return h * 60 + m;
    }
    function nowMinutes() {
      const n = new Date();
      return n.getHours() * 60 + n.getMinutes();
    }
    function formatClock(hhmm) {
      const mins = timeToMinutes(hhmm);
      if (mins == null) return hhmm || '';
      const dt = new Date();
      dt.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
      return dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    function defaultHandoffTime(iso) {
      return schoolLabel(iso) ? NOSCHOOL_HANDOFF : SCHOOL_HANDOFF;
    }

    function normalizeHandoffs(raw) {
      const out = {};
      if (!raw || typeof raw !== 'object') return out;
      for (const [iso, v] of Object.entries(raw)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !v || typeof v !== 'object') continue;
        if (v.fullDay) out[iso] = { fullDay: true };
        else if (typeof v.time === 'string' && /^\d{1,2}:\d{2}$/.test(v.time)) {
          const [h, m] = v.time.split(':');
          out[iso] = { time: String(h).padStart(2, '0') + ':' + m };
        }
      }
      return out;
    }

    function normalizeData(raw) {
      const base = defaultData();
      if (!raw || typeof raw !== 'object') return base;
      return {
        version: raw.version || 1,
        updatedAt: raw.updatedAt || null,
        parents: {
          mom: {
            label: raw.parents?.mom?.label || base.parents.mom.label,
            color: raw.parents?.mom?.color || base.parents.mom.color,
          },
          dad: {
            label: raw.parents?.dad?.label || base.parents.dad.label,
            color: raw.parents?.dad?.color || base.parents.dad.color,
          },
        },
        blocks: Array.isArray(raw.blocks)
          ? raw.blocks
              .map((b) => ({
                id: b.id || uid(),
                parent: b.parent === 'dad' ? 'dad' : 'mom',
                startDate: b.startDate,
                endDate: b.endDate || b.startDate,
                startTime: b.startTime || null,
                endTime: b.endTime || null,
                note: b.note || '',
              }))
              .filter((b) => b.startDate)
          : [],
        handoffs: normalizeHandoffs(raw.handoffs),
      };
    }

    function rebuildNoSchoolMap() {
      noSchoolMap = new Map();
      if (!tusdCal || !Array.isArray(tusdCal.years)) return;
      for (const year of tusdCal.years) {
        for (const br of year.breaks || []) {
          if (!br.start || !br.end) continue;
          eachDate(br.start, br.end, (iso) => noSchoolMap.set(iso, br.name || 'Recess'));
        }
        for (const d of year.nonStudentDays || []) {
          if (d.date) noSchoolMap.set(d.date, d.name || 'No school');
        }
      }
    }

    function schoolLabel(iso) {
      return noSchoolMap.get(iso) || null;
    }

    function shortSchoolLabel(name) {
      if (!name) return '';
      const n = String(name);
      if (/spring/i.test(n)) return 'Spring break';
      if (/winter/i.test(n)) return 'Winter break';
      if (/fall/i.test(n)) return 'Fall break';
      if (/labor/i.test(n)) return 'Labor Day';
      if (/memorial/i.test(n)) return 'Memorial Day';
      if (/veterans/i.test(n)) return "Veterans Day";
      if (/mlk|king/i.test(n)) return 'MLK Day';
      if (/lincoln/i.test(n)) return "Lincoln's Day";
      if (/washington/i.test(n)) return "Presidents Day";
      if (/staff|teacher|development|work day/i.test(n)) return 'No school';
      return n.length > 18 ? n.slice(0, 16) + '…' : n;
    }

    function handoffOverride(iso) {
      return (data.handoffs && data.handoffs[iso]) || null;
    }
    function parentColor(parent) {
      return data.parents[parent]?.color || '#555';
    }
    function paintSplitBackground(el, morning, afternoon) {
      const a = parentColor(morning);
      const b = parentColor(afternoon);
      el.style.background = `linear-gradient(90deg, ${a} 0 50%, ${b} 50% 100%)`;
    }
    function assignmentLabel(asg) {
      if (!asg) return null;
      return data.parents[asg.parent]?.label || asg.parent;
    }
    function paintBackground(el, parent) {
      const color = data.parents[parent]?.color || '#555';
      el.style.background = `linear-gradient(160deg, ${color}, color-mix(in srgb, ${color} 72%, #0a0a0a))`;
    }

    function enrichDay(iso, rawToday, rawNext) {
      if (!rawToday) return null;
      const ov = handoffOverride(iso);
      const nextParent = rawNext && rawNext.parent;
      const split = !!(nextParent && nextParent !== rawToday.parent && !(ov && ov.fullDay));
      return {
        parent: rawToday.parent,
        note: rawToday.note || '',
        startTime: rawToday.startTime || '',
        endTime: rawToday.endTime || '',
        blockId: rawToday.blockId,
        morningParent: rawToday.parent,
        afternoonParent: split ? nextParent : rawToday.parent,
        isTransition: split,
        handoffTime: split ? (ov && ov.time) || defaultHandoffTime(iso) : null,
        fullDayOverride: !!(ov && ov.fullDay),
      };
    }

    function rawDayMap() {
      const map = {};
      for (const b of data.blocks) {
        if (!b || !b.parent || !b.startDate) continue;
        const end = b.endDate || b.startDate;
        eachDate(b.startDate, end, (iso) => {
          map[iso] = {
            parent: b.parent,
            note: b.note || '',
            startTime: b.startTime || '',
            endTime: b.endTime || '',
            blockId: b.id,
          };
        });
      }
      return map;
    }

    function dayMap() {
      const raw = rawDayMap();
      const map = {};
      for (const iso of Object.keys(raw)) {
        map[iso] = enrichDay(iso, raw[iso], raw[addDaysISO(iso, 1)]);
      }
      return map;
    }

    function splitLabel(asg) {
      if (!asg || !asg.isTransition) return asg ? shortLabel(assignmentLabel(asg), asg.parent) : '';
      const am = shortLabel(data.parents[asg.morningParent]?.label, asg.morningParent);
      const pm = shortLabel(data.parents[asg.afternoonParent]?.label, asg.afternoonParent);
      return am + ' → ' + pm;
    }

    function appendInitials(host, asg) {
      if (!asg) return;
      if (asg.isTransition) {
        const wrap = document.createElement('span');
        wrap.className = 'initials-pair';
        const a = document.createElement('span');
        a.className = 'parent-initial';
        a.textContent = parentInitial(asg.morningParent);
        const b = document.createElement('span');
        b.className = 'parent-initial';
        b.textContent = parentInitial(asg.afternoonParent);
        wrap.appendChild(a);
        wrap.appendChild(b);
        host.appendChild(wrap);
        return;
      }
      const ini = document.createElement('span');
      ini.className = 'parent-initial';
      ini.textContent = parentInitial(asg.parent);
      host.appendChild(ini);
    }

    function appendTodayFlag(host) {
      const flag = document.createElement('span');
      flag.className = 'today-flag';
      flag.textContent = 'Today';
      host.appendChild(flag);
    }

    function paintDayTile(el, asg) {
      if (!asg) return;
      el.classList.add('has-parent');
      if (asg.isTransition) {
        el.classList.add('split');
        paintSplitBackground(el, asg.morningParent, asg.afternoonParent);
        return;
      }
      paintBackground(el, asg.parent);
      if (asg.startTime || asg.endTime) el.classList.add('partial');
    }

    function isBeforeHandoff(asg) {
      if (!asg || !asg.isTransition || !asg.handoffTime) return false;
      const mins = timeToMinutes(asg.handoffTime);
      return mins != null && nowMinutes() < mins;
    }

    function formatDayLong(iso) {
      return dateFromISO(iso).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      });
    }
    function formatDayShort(iso) {
      return dateFromISO(iso).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }
    function daysBetweenInclusive(startIso, endIso) {
      let n = 0;
      eachDate(startIso, endIso, () => {
        n += 1;
      });
      return n;
    }

    function stayBlockAround(map, iso) {
      const asg = map[iso];
      if (!asg) return null;
      let start = iso;
      let end = iso;
      for (let i = 0; i < 400; i++) {
        const prev = addDaysISO(start, -1);
        if (map[prev]?.parent === asg.parent) start = prev;
        else break;
      }
      for (let i = 0; i < 400; i++) {
        const next = addDaysISO(end, 1);
        if (map[next]?.parent === asg.parent) end = next;
        else break;
      }
      return { parent: asg.parent, start, end, asg };
    }

    function findNextAssignment(map, fromIso) {
      for (let i = 0; i < 400; i++) {
        const iso = addDaysISO(fromIso, i);
        const a = map[iso];
        if (!a) continue;
        return { iso, asg: a };
      }
      return null;
    }

    function stayCountdownCopy(today, end, daysLeft) {
      if (daysLeft <= 1) {
        return {
          headline: 'Last day of this stretch',
          detail: 'Through today · ' + formatDayLong(today),
        };
      }
      if (daysLeft === 2) {
        return {
          headline: 'Through tomorrow',
          detail: formatDayLong(end) + ' · 2 days left including today',
        };
      }
      return {
        headline: daysLeft + ' more days · through ' + formatDayShort(end),
        detail: 'This stretch runs through ' + formatDayLong(end),
      };
    }

    function paintHeroParent(hero, parent) {
      hero.dataset.parent = parent || 'none';
      const color = parent ? parentColor(parent) : '';
      if (color) {
        hero.style.background =
          parent === 'dad'
            ? `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 65%, #1a1a2e))`
            : `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 65%, #0a2a22))`;
      } else hero.style.background = '';
    }

    function applyParentCss() {
      const mom = data.parents.mom.color || '#2f9e86';
      const dad = data.parents.dad.color || '#6b7cff';
      document.documentElement.style.setProperty('--mom', mom);
      document.documentElement.style.setProperty('--dad', dad);
    }

    function renderLegend() {
      const el = $('legend');
      if (!el) return;
      el.innerHTML = '';
      for (const key of ['mom', 'dad']) {
        const p = data.parents[key];
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `<span class="legend-swatch" style="background:${p.color}"></span><span></span>`;
        item.querySelector('span:last-child').textContent = `${p.label} (${parentInitial(key)})`;
        el.appendChild(item);
      }
      if (noSchoolMap.size) {
        const school = document.createElement('div');
        school.className = 'legend-item';
        school.innerHTML = `<span class="legend-swatch" style="background:#e8c878"></span><span>TUSD no school</span>`;
        el.appendChild(school);
      }
      const todayItem = document.createElement('div');
      todayItem.className = 'legend-item';
      todayItem.innerHTML = `<span class="legend-swatch today-swatch"></span><span>Today</span>`;
      el.appendChild(todayItem);
      const tip = document.createElement('div');
      tip.className = 'legend-hint';
      tip.textContent = 'Split = last day of a stretch (morning that house, afternoon the next) · gold = no school';
      el.appendChild(tip);
    }

    function renderHero() {
      const map = dayMap();
      const today = todayISO();
      const hero = $('heroStay');
      if (!hero) return;
      const schoolToday = schoolLabel(today);
      const todayAsg = map[today];
      const stay = stayBlockAround(map, today);
      const progressWrap = $('heroProgressWrap');
      const progressBar = $('heroProgressBar');

      if (todayAsg && todayAsg.isTransition && isBeforeHandoff(todayAsg)) {
        paintHeroParent(hero, todayAsg.morningParent);
        const morningLabel = data.parents[todayAsg.morningParent]?.label || shortLabel(null, todayAsg.morningParent);
        const afternoonLabel = data.parents[todayAsg.afternoonParent]?.label || shortLabel(null, todayAsg.afternoonParent);
        $('heroKicker').textContent = 'Right now';
        $('heroPlace').textContent = morningLabel;
        $('heroCountdown').textContent = 'Last morning · handoff at ' + formatClock(todayAsg.handoffTime);
        const bits = ['Morning at ' + morningLabel, afternoonLabel + ' after ' + formatClock(todayAsg.handoffTime)];
        if (schoolToday) bits.push('TUSD: ' + schoolToday);
        if (todayAsg.note) bits.push(todayAsg.note);
        $('heroSub').textContent = bits.join(' · ');
        progressWrap.hidden = true;
        progressBar.style.width = '0%';
        const c = parentColor(todayAsg.afternoonParent);
        $('heroNextPlace').innerHTML = `<span class="stat-dot" style="background:${c}"></span><span></span>`;
        $('heroNextPlace').querySelector('span:last-child').textContent = afternoonLabel;
        $('heroNextWhen').textContent = 'Starting this afternoon · ' + formatClock(todayAsg.handoffTime);
        const nextStay = stayBlockAround(map, addDaysISO(today, 1));
        if (nextStay) {
          const nextLen = daysBetweenInclusive(nextStay.start, nextStay.end);
          $('heroNextDetail').textContent =
            nextLen === 1 ? 'One full day there tomorrow' : nextLen + ' days there · through ' + formatDayShort(nextStay.end);
        } else {
          $('heroNextDetail').textContent = 'First night there tonight';
        }
        return;
      }

      if (todayAsg && todayAsg.isTransition && !isBeforeHandoff(todayAsg)) {
        paintHeroParent(hero, todayAsg.afternoonParent);
        const afternoonLabel = data.parents[todayAsg.afternoonParent]?.label || shortLabel(null, todayAsg.afternoonParent);
        $('heroKicker').textContent = 'Right now';
        $('heroPlace').textContent = afternoonLabel;
        $('heroCountdown').textContent = 'First night · since ' + formatClock(todayAsg.handoffTime);
        const bits = ['Handoff was at ' + formatClock(todayAsg.handoffTime)];
        if (schoolToday) bits.push('TUSD: ' + schoolToday);
        if (todayAsg.note) bits.push(todayAsg.note);
        $('heroSub').textContent = bits.join(' · ');
        const nextStay = stayBlockAround(map, addDaysISO(today, 1));
        if (nextStay) {
          const nextLen = daysBetweenInclusive(nextStay.start, nextStay.end);
          progressWrap.hidden = nextLen <= 1;
          progressBar.style.width = nextLen > 1 ? Math.min(100, Math.round((1 / (nextLen + 1)) * 100)) + '%' : '100%';
          $('heroNextPlace').innerHTML =
            `<span class="stat-dot" style="background:${parentColor(todayAsg.afternoonParent)}"></span><span></span>`;
          $('heroNextPlace').querySelector('span:last-child').textContent = afternoonLabel;
          $('heroNextWhen').textContent = 'Continuing tomorrow';
          $('heroNextDetail').textContent =
            nextLen === 1 ? 'Through ' + formatDayShort(nextStay.end) : nextLen + ' more days · through ' + formatDayShort(nextStay.end);
        } else {
          progressWrap.hidden = true;
          progressBar.style.width = '100%';
          $('heroNextPlace').innerHTML = '<span class="stat-muted">Tonight only so far</span>';
          $('heroNextWhen').textContent = 'Rest of this stretch is not on the board yet';
          $('heroNextDetail').textContent = '';
        }
        return;
      }

      if (stay) {
        paintHeroParent(hero, stay.parent);
        const place = shortLabel(assignmentLabel(stay.asg), stay.parent);
        const fullLabel = data.parents[stay.parent]?.label || place;
        $('heroKicker').textContent = 'Right now';
        $('heroPlace').textContent = fullLabel;
        const daysLeft = daysBetweenInclusive(today, stay.end);
        const totalDays = daysBetweenInclusive(stay.start, stay.end);
        const daysDone = daysBetweenInclusive(stay.start, today);
        const copy = stayCountdownCopy(today, stay.end, daysLeft);
        $('heroCountdown').textContent = copy.headline;
        const bits = [copy.detail];
        if (totalDays > 1) bits.push('Day ' + daysDone + ' of ' + totalDays + ' in this stretch');
        if (schoolToday) bits.push('TUSD: ' + schoolToday);
        if (stay.asg.startTime || stay.asg.endTime) {
          bits.push([stay.asg.startTime, stay.asg.endTime].filter(Boolean).join(' – '));
        }
        if (stay.asg.note) bits.push(stay.asg.note);
        $('heroSub').textContent = bits.join(' · ');
        progressWrap.hidden = totalDays <= 1;
        progressBar.style.width = totalDays > 1 ? Math.min(100, Math.round((daysDone / totalDays) * 100)) + '%' : '100%';

        const after = addDaysISO(stay.end, 1);
        const next = findNextAssignment(map, after);
        if (next) {
          const nextLabel = data.parents[next.asg.parent]?.label || shortLabel(assignmentLabel(next.asg), next.asg.parent);
          const c = data.parents[next.asg.parent]?.color || '#888';
          $('heroNextPlace').innerHTML = `<span class="stat-dot" style="background:${c}"></span><span></span>`;
          $('heroNextPlace').querySelector('span:last-child').textContent = nextLabel;
          $('heroNextWhen').textContent = 'Starting ' + formatDayLong(next.iso);
          if (next.iso === after) {
            const nextStay = stayBlockAround(map, next.iso);
            if (nextStay) {
              const nextLen = daysBetweenInclusive(nextStay.start, nextStay.end);
              $('heroNextDetail').textContent =
                nextLen === 1 ? 'One day there' : nextLen + ' days there · through ' + formatDayShort(nextStay.end);
            } else {
              $('heroNextDetail').textContent = '';
            }
          } else {
            const gapDays = daysBetweenInclusive(after, addDaysISO(next.iso, -1));
            $('heroNextDetail').textContent =
              gapDays > 0 ? gapDays + ' open day' + (gapDays === 1 ? '' : 's') + ' in between' : '';
          }
        } else {
          $('heroNextPlace').innerHTML = '<span class="stat-muted">Nothing scheduled next</span>';
          $('heroNextWhen').textContent = 'After ' + formatDayShort(stay.end);
          $('heroNextDetail').textContent = '';
        }
        return;
      }

      hero.dataset.parent = 'none';
      hero.style.background = '';
      $('heroKicker').textContent = 'Right now';
      $('heroPlace').textContent = 'Not set';
      $('heroCountdown').textContent = 'No house assigned for today';
      $('heroSub').textContent = schoolToday ? 'TUSD: ' + schoolToday : 'Check back after a parent updates the shared schedule.';
      progressWrap.hidden = true;
      progressBar.style.width = '0%';
      const next = findNextAssignment(map, today);
      if (next) {
        const nextLabel = data.parents[next.asg.parent]?.label || shortLabel(assignmentLabel(next.asg), next.asg.parent);
        const c = data.parents[next.asg.parent]?.color || '#888';
        $('heroNextPlace').innerHTML = `<span class="stat-dot" style="background:${c}"></span><span></span>`;
        $('heroNextPlace').querySelector('span:last-child').textContent = nextLabel;
        $('heroNextWhen').textContent = 'Next set day: ' + formatDayLong(next.iso);
        const nextStay = stayBlockAround(map, next.iso);
        if (nextStay) {
          const nextLen = daysBetweenInclusive(nextStay.start, nextStay.end);
          $('heroNextDetail').textContent = nextLen + ' day stretch · through ' + formatDayShort(nextStay.end);
        } else {
          $('heroNextDetail').textContent = '';
        }
      } else {
        $('heroNextPlace').innerHTML = '<span class="stat-muted">Nothing scheduled</span>';
        $('heroNextWhen').textContent = 'The shared board is empty for now';
        $('heroNextDetail').textContent = '';
      }
    }

    function multiMonthCount() {
      if (viewMode === 'quarter') return 3;
      if (viewMode === 'sixmonth') return 6;
      if (viewMode === 'year') return 12;
      return 0;
    }

    function updateRangeLabel() {
      if (viewMode === 'month') {
        $('rangeLabel').textContent = new Date(viewYear, viewMonth, 1).toLocaleString(undefined, {
          month: 'long',
          year: 'numeric',
        });
        return;
      }
      if (LONG_VIEWS.has(viewMode)) {
        const n = multiMonthCount();
        const start = multiAnchor;
        const end = new Date(start.getFullYear(), start.getMonth() + n - 1, 1);
        if (viewMode === 'year') {
          $('rangeLabel').textContent = String(start.getFullYear());
        } else {
          $('rangeLabel').textContent =
            start.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) +
            ' – ' +
            end.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
        }
        return;
      }
      const days = viewMode === 'twoweek' ? 14 : 7;
      const start = viewStart;
      const end = addDaysDate(start, days - 1);
      const optsEnd = end.getMonth() === start.getMonth() ? { day: 'numeric' } : { month: 'short', day: 'numeric' };
      $('rangeLabel').textContent =
        start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ' – ' +
        end.toLocaleDateString(undefined, optsEnd);
    }

    function renderWeekBoard() {
      const panel = $('weekPanel');
      panel.innerHTML = '';
      const map = dayMap();
      const today = todayISO();
      const weekCount = viewMode === 'twoweek' ? 2 : 1;

      for (let w = 0; w < weekCount; w++) {
        const weekStart = addDaysDate(viewStart, w * 7);
        if (weekCount > 1) {
          const lab = document.createElement('div');
          lab.className = 'week-row-label';
          const weekEnd = addDaysDate(weekStart, 6);
          lab.textContent =
            weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
            ' – ' +
            weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          panel.appendChild(lab);
        }
        const strip = document.createElement('div');
        strip.className = 'week-strip';
        for (let i = 0; i < 7; i++) {
          const d = addDaysDate(weekStart, i);
          const iso = toISOFromDate(d);
          const asg = map[iso];
          const btn = document.createElement('div');
          btn.className = 'week-day';
          btn.dataset.date = iso;
          if (iso === today) {
            btn.classList.add('today');
            btn.setAttribute('aria-current', 'date');
          }
          if (asg) paintDayTile(btn, asg);
          else btn.classList.add('week-empty');
          if (iso === today) appendTodayFlag(btn);

          const dow = document.createElement('div');
          dow.className = 'week-dow';
          dow.textContent = d.toLocaleDateString(undefined, { weekday: 'short' });
          btn.appendChild(dow);

          const dateEl = document.createElement('div');
          dateEl.className = 'week-date';
          dateEl.textContent = String(d.getDate());
          appendInitials(dateEl, asg);
          btn.appendChild(dateEl);

          const place = document.createElement('div');
          place.className = 'week-place';
          place.textContent = asg ? splitLabel(asg) : 'Open';
          btn.appendChild(place);

          if (asg && asg.isTransition && asg.handoffTime) {
            const t = document.createElement('div');
            t.className = 'week-time';
            t.textContent = formatClock(asg.handoffTime);
            btn.appendChild(t);
          } else if (asg && (asg.startTime || asg.endTime)) {
            const t = document.createElement('div');
            t.className = 'week-time';
            t.textContent = [asg.startTime, asg.endTime].filter(Boolean).join('–');
            btn.appendChild(t);
          }
          if (asg && asg.note) {
            const note = document.createElement('div');
            note.className = 'week-note';
            note.textContent = asg.note;
            note.title = asg.note;
            btn.appendChild(note);
            btn.title = asg.note;
          }
          const school = schoolLabel(iso);
          if (school) {
            const badge = document.createElement('div');
            badge.className = 'school-badge';
            badge.textContent = shortSchoolLabel(school);
            badge.title = school;
            btn.appendChild(badge);
          }
          strip.appendChild(btn);
        }
        panel.appendChild(strip);
      }
    }

    function renderMonth() {
      const grid = $('calGrid');
      grid.innerHTML = '';
      const first = new Date(viewYear, viewMonth, 1);
      const startPad = first.getDay();
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      const prevDays = new Date(viewYear, viewMonth, 0).getDate();
      const map = dayMap();
      const today = todayISO();
      const cells = [];

      for (let i = startPad - 1; i >= 0; i--) {
        const day = prevDays - i;
        const m = viewMonth === 0 ? 11 : viewMonth - 1;
        const y = viewMonth === 0 ? viewYear - 1 : viewYear;
        cells.push({ y, m, day, outside: true });
      }
      for (let day = 1; day <= daysInMonth; day++) cells.push({ y: viewYear, m: viewMonth, day, outside: false });
      while (cells.length % 7 !== 0) {
        const idx = cells.length - (startPad + daysInMonth);
        const day = idx + 1;
        const m = viewMonth === 11 ? 0 : viewMonth + 1;
        const y = viewMonth === 11 ? viewYear + 1 : viewYear;
        cells.push({ y, m, day, outside: true });
      }

      for (const c of cells) {
        const iso = toISO(c.y, c.m, c.day);
        const cell = document.createElement('div');
        cell.className = 'day-cell';
        cell.dataset.date = iso;
        if (c.outside) cell.classList.add('outside');
        if (iso === today) {
          cell.classList.add('today');
          cell.setAttribute('aria-current', 'date');
        }
        const asg = map[iso];
        if (asg) paintDayTile(cell, asg);
        if (iso === today) appendTodayFlag(cell);

        const num = document.createElement('div');
        num.className = 'day-num';
        num.textContent = String(c.day);
        appendInitials(num, asg);
        cell.appendChild(num);

        const place = document.createElement('div');
        place.className = 'day-place';
        place.textContent = asg ? splitLabel(asg) : c.outside ? '' : 'Open';
        cell.appendChild(place);

        if (asg && asg.isTransition && asg.handoffTime) {
          const t = document.createElement('div');
          t.className = 'day-time';
          t.textContent = formatClock(asg.handoffTime);
          cell.appendChild(t);
        } else if (asg && (asg.startTime || asg.endTime)) {
          const t = document.createElement('div');
          t.className = 'day-time';
          t.textContent = [asg.startTime, asg.endTime].filter(Boolean).join('–');
          cell.appendChild(t);
        }
        if (asg && asg.note) {
          const note = document.createElement('div');
          note.className = 'day-note';
          note.textContent = asg.note;
          note.title = asg.note;
          cell.appendChild(note);
          cell.title = asg.note;
        }
        const school = schoolLabel(iso);
        if (school) {
          const mark = document.createElement('span');
          mark.className = 'day-school-mark';
          mark.textContent = shortSchoolLabel(school);
          mark.title = school;
          cell.appendChild(mark);
        }
        grid.appendChild(cell);
      }
    }

    function renderMultiMonths() {
      const panel = $('multiPanel');
      panel.innerHTML = '';
      const n = multiMonthCount();
      panel.className = 'multi-panel' + (n === 3 ? ' cols-3' : n === 6 ? ' cols-6' : n === 12 ? ' cols-12' : '');
      const map = dayMap();
      const today = todayISO();
      const anchor = multiAnchor || startOfDay(new Date());

      for (let i = 0; i < n; i++) {
        const monthDate = new Date(anchor.getFullYear(), anchor.getMonth() + i, 1);
        const y = monthDate.getFullYear();
        const m = monthDate.getMonth();
        const card = document.createElement('div');
        card.className = 'mini-month';

        const title = document.createElement('div');
        title.className = 'mini-month-title';
        title.textContent = monthDate.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
        title.title = 'Open month view';
        title.addEventListener('click', () => {
          viewYear = y;
          viewMonth = m;
          setViewMode('month');
        });
        card.appendChild(title);

        const dows = document.createElement('div');
        dows.className = 'mini-dows';
        ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((t) => {
          const s = document.createElement('span');
          s.textContent = t;
          dows.appendChild(s);
        });
        card.appendChild(dows);

        const grid = document.createElement('div');
        grid.className = 'mini-grid';
        const first = new Date(y, m, 1);
        const startPad = first.getDay();
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        for (let p = 0; p < startPad; p++) {
          const empty = document.createElement('span');
          empty.className = 'mini-day outside';
          grid.appendChild(empty);
        }
        for (let day = 1; day <= daysInMonth; day++) {
          const iso = toISO(y, m, day);
          const asg = map[iso];
          const cell = document.createElement('div');
          cell.className = 'mini-day';
          cell.dataset.date = iso;
          cell.textContent = String(day);
          if (iso === today) {
            cell.classList.add('today');
            cell.setAttribute('aria-current', 'date');
          }
          if (asg) {
            cell.classList.add('has-parent');
            if (asg.isTransition) {
              cell.classList.add('split');
              paintSplitBackground(cell, asg.morningParent, asg.afternoonParent);
              cell.title = splitLabel(asg);
            } else {
              cell.style.background = parentColor(asg.parent);
              cell.title = shortLabel(assignmentLabel(asg), asg.parent) + ' (' + parentInitial(asg.parent) + ')';
            }
            if (asg.note) cell.title = (cell.title ? cell.title + ' · ' : '') + asg.note;
          }
          if (schoolLabel(iso)) cell.classList.add('no-school');
          grid.appendChild(cell);
        }
        card.appendChild(grid);
        panel.appendChild(card);
      }
    }

    function renderAll() {
      updateRangeLabel();
      renderHero();
      renderLegend();
      if (viewMode === 'month') renderMonth();
      else if (LONG_VIEWS.has(viewMode)) renderMultiMonths();
      else renderWeekBoard();
    }

    function setViewMode(mode) {
      if (mode === 'year') {
        multiAnchor = new Date((multiAnchor || new Date()).getFullYear(), 0, 1);
      } else if (LONG_VIEWS.has(mode) && !multiAnchor) {
        multiAnchor = new Date(viewYear, viewMonth, 1);
      }
      viewMode = mode;
      localStorage.setItem(viewKey, mode);
      document.querySelectorAll('.view-switch button').forEach((b) => {
        b.classList.toggle('active', b.dataset.view === mode);
      });
      $('weekPanel').classList.toggle('panel-hidden', mode === 'month' || LONG_VIEWS.has(mode));
      $('monthPanel').classList.toggle('panel-hidden', mode !== 'month');
      $('multiPanel').classList.toggle('panel-hidden', !LONG_VIEWS.has(mode));
      renderAll();
    }

    function jumpToToday() {
      const now = new Date();
      viewStart = startOfWeek(now);
      viewYear = now.getFullYear();
      viewMonth = now.getMonth();
      multiAnchor = new Date(now.getFullYear(), now.getMonth(), 1);
      if (viewMode === 'year') multiAnchor = new Date(now.getFullYear(), 0, 1);
      renderAll();
    }

    function shiftRange(dir) {
      if (viewMode === 'month') {
        viewMonth += dir;
        if (viewMonth < 0) {
          viewMonth = 11;
          viewYear -= 1;
        }
        if (viewMonth > 11) {
          viewMonth = 0;
          viewYear += 1;
        }
      } else if (LONG_VIEWS.has(viewMode)) {
        const step = multiMonthCount();
        multiAnchor = new Date(multiAnchor.getFullYear(), multiAnchor.getMonth() + dir * step, 1);
      } else {
        const step = viewMode === 'twoweek' ? 14 : 7;
        viewStart = addDaysDate(viewStart, dir * step);
      }
      renderAll();
    }

    function formatUpdated(iso) {
      if (!iso) return 'No saves yet';
      try {
        return (
          'Last saved ' +
          new Date(iso).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
        );
      } catch {
        return 'Last saved ' + iso;
      }
    }

    function tickClock() {
      const now = new Date();
      if ($('clockTime')) {
        $('clockTime').textContent = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      }
      if ($('clockDate')) {
        $('clockDate').textContent = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      }
    }

    function startClock() {
      tickClock();
      if (clockTimer) clearInterval(clockTimer);
      clockTimer = setInterval(tickClock, 15000);
    }

    function stopClock() {
      if (clockTimer) clearInterval(clockTimer);
      clockTimer = null;
    }

    function icsDate(iso) {
      return String(iso).replace(/-/g, '');
    }
    function icsDateTime(iso, hhmm) {
      const [h, m] = String(hhmm || '00:00').split(':');
      return icsDate(iso) + 'T' + String(h).padStart(2, '0') + String(m).padStart(2, '0') + '00';
    }
    function escapeIcs(s) {
      return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    }
    function pushIcsEvent(lines, stamp, ev) {
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + (ev.uid || uid()) + '@custody-calendar');
      lines.push('DTSTAMP:' + stamp);
      if (ev.allDay) {
        lines.push('DTSTART;VALUE=DATE:' + icsDate(ev.start));
        lines.push('DTEND;VALUE=DATE:' + icsDate(ev.endExclusive));
      } else {
        lines.push('DTSTART:' + icsDateTime(ev.start, ev.startTime));
        lines.push('DTEND:' + icsDateTime(ev.end, ev.endTime));
      }
      lines.push('SUMMARY:' + escapeIcs(ev.summary));
      if (ev.description) lines.push('DESCRIPTION:' + escapeIcs(ev.description));
      lines.push('END:VEVENT');
    }

    function buildIcs() {
      const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Casas Kids Calendar//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Casas Kids Calendar',
      ];
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const map = dayMap();
      const dates = Object.keys(map).sort(compareISO);
      let run = null;
      const flushRun = () => {
        if (!run) return;
        const label = data.parents[run.parent]?.label || run.parent;
        pushIcsEvent(lines, stamp, {
          uid: run.uid,
          allDay: true,
          start: run.start,
          endExclusive: addDaysISO(run.end, 1),
          summary: label,
          description: label,
        });
        run = null;
      };
      for (const iso of dates) {
        const asg = map[iso];
        if (!asg) continue;
        if (asg.isTransition) {
          flushRun();
          const am = data.parents[asg.morningParent]?.label || asg.morningParent;
          const pm = data.parents[asg.afternoonParent]?.label || asg.afternoonParent;
          const handoff = asg.handoffTime || defaultHandoffTime(iso);
          const next = addDaysISO(iso, 1);
          pushIcsEvent(lines, stamp, {
            uid: (asg.blockId || uid()) + '-am',
            start: iso,
            startTime: '00:00',
            end: iso,
            endTime: handoff,
            summary: am,
            description: am + ' until ' + formatClock(handoff),
          });
          pushIcsEvent(lines, stamp, {
            uid: (asg.blockId || uid()) + '-pm',
            start: iso,
            startTime: handoff,
            end: next,
            endTime: '00:00',
            summary: pm,
            description: pm + ' from ' + formatClock(handoff),
          });
          continue;
        }
        if (run && run.parent === asg.parent && addDaysISO(run.end, 1) === iso) {
          run.end = iso;
        } else {
          flushRun();
          run = { parent: asg.parent, start: iso, end: iso, uid: asg.blockId };
        }
      }
      flushRun();
      lines.push('END:VCALENDAR');
      return lines.join('\r\n') + '\r\n';
    }

    function setData(raw) {
      data = normalizeData(raw);
      applyParentCss();
    }

    function setTusdCal(cal) {
      tusdCal = cal;
      rebuildNoSchoolMap();
    }

    function initNav() {
      const now = new Date();
      viewStart = startOfWeek(now);
      viewYear = now.getFullYear();
      viewMonth = now.getMonth();
      multiAnchor = new Date(now.getFullYear(), now.getMonth(), 1);
      setViewMode(viewMode);
    }

    return {
      defaultData,
      normalizeData,
      setData,
      setTusdCal,
      renderAll,
      setViewMode,
      jumpToToday,
      shiftRange,
      applyParentCss,
      tickClock,
      startClock,
      stopClock,
      formatUpdated,
      buildIcs,
      initNav,
      getUpdatedAt: () => data.updatedAt,
      LONG_VIEWS,
    };
  }

  global.CustodyKidsView = { create, defaultData };
})(window);
