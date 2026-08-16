/**
 * Schedule pattern helpers + lightweight natural-language interpretation.
 * Expands to concrete days — no locked recurrence engine.
 */
(function (global) {
  'use strict';

  const DOW_NAMES = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tues: 2, tuesday: 2,
    wed: 3, weds: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6,
  };

  const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function expandDowRange(a, b) {
    const out = [];
    let i = a;
    // inclusive walk around the week (Wed→Mon wraps)
    for (let n = 0; n < 7; n++) {
      out.push(i);
      if (i === b) break;
      i = (i + 1) % 7;
    }
    return out;
  }

  function parseDowToken(tok) {
    const t = String(tok || '').toLowerCase().replace(/\./g, '');
    return DOW_NAMES[t];
  }

  /** "wed through monday", "wed-mon", "wednesday to friday" */
  function parseDaySpan(text) {
    const t = text.toLowerCase();
    let m = t.match(
      /\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesdays?|s)?|thu(?:rs?|rsday)?|fri(?:day)?|sat(?:urday)?)\b\s*(?:through|thru|to|-|–|—)\s*\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesdays?|s)?|thu(?:rs?|rsday)?|fri(?:day)?|sat(?:urday)?)\b/
    );
    if (m) {
      const a = parseDowToken(m[1]);
      const b = parseDowToken(m[2]);
      if (a != null && b != null) return expandDowRange(a, b);
    }
    // single day
    m = t.match(
      /\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesdays?|s)?|thu(?:rs?|rsday)?|fri(?:day)?|sat(?:urday)?)\b/
    );
    if (m) {
      const d = parseDowToken(m[1]);
      if (d != null) return [d];
    }
    if (/\bweekend\b/.test(t)) return [6, 0];
    if (/\bweekdays?\b/.test(t)) return [1, 2, 3, 4, 5];
    return null;
  }

  function parseParent(text, momLabel, dadLabel) {
    const t = text.toLowerCase();
    // Prefer the first explicit house mention (so "with Dad … fill rest with Mom" → Dad)
    const re = /\b(mom|mother|dad|father|us|ours?|them)\b/gi;
    let m;
    while ((m = re.exec(t)) !== null) {
      const w = m[1].toLowerCase();
      if (w === 'mom' || w === 'mother') return 'mom';
      if (w === 'dad' || w === 'father') return 'dad';
      if (w === 'us' || w === 'our' || w === 'ours') return 'dad';
      if (w === 'them') return 'mom';
    }
    const mom = (momLabel || 'mom').toLowerCase().split("'")[0];
    const dad = (dadLabel || 'dad').toLowerCase().split("'")[0];
    const mi = t.indexOf(mom);
    const di = t.indexOf(dad);
    if (mi >= 0 && (di < 0 || mi < di)) return 'mom';
    if (di >= 0) return 'dad';
    return null;
  }

  function parseIsoDateLoose(text) {
    // YYYY-MM-DD
    let m = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
    if (m) {
      return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    }
    // Month D, YYYY or Month D
    m = text.match(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i
    );
    if (m) {
      const months = {
        jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
        may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
        september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
      };
      const mi = months[m[1].toLowerCase()];
      const day = Number(m[2]);
      const year = m[3] ? Number(m[3]) : new Date().getFullYear();
      if (mi != null) {
        return `${year}-${String(mi + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
    return null;
  }

  function formatDays(days) {
    return (days || []).map((d) => DOW_SHORT[d]).join(', ');
  }

  /**
   * Interpret free text into a structured schedule pattern.
   * @returns {{ ok: boolean, error?: string, summary?: string, config?: object }}
   */
  function interpretNaturalLanguage(raw, opts) {
    opts = opts || {};
    const text = String(raw || '').trim();
    if (!text) return { ok: false, error: 'Type a description first.' };

    const lower = text.toLowerCase();
    const momLabel = opts.momLabel || "Mom's House";
    const dadLabel = opts.dadLabel || "Dad's House";

    // Date range: "from X through Y" / "starting X"
    let start = null;
    let end = null;
    let m = lower.match(/\bfrom\s+(.+?)\s+(?:through|thru|to|until|–|-)\s+(.+?)(?:\.|$)/i);
    if (m) {
      start = parseIsoDateLoose(m[1]) || parseIsoDateLoose(text.slice(text.toLowerCase().indexOf('from')));
      // re-parse pieces from original for month names
      const fromIdx = lower.indexOf('from ');
      const throughMatch = text.slice(fromIdx).match(/from\s+(.+?)\s+(?:through|thru|to|until)\s+(.+?)(?:\.|$)/i);
      if (throughMatch) {
        start = parseIsoDateLoose(throughMatch[1]);
        end = parseIsoDateLoose(throughMatch[2]);
      }
    }
    m = lower.match(/\bstarting\s+(.+?)(?:\.|,|$)/i);
    if (!start && m) start = parseIsoDateLoose(m[1]);
    m = text.match(/\bstarting\s+([A-Za-z0-9 ,/-]+)/i);
    if (!start && m) start = parseIsoDateLoose(m[1]);

    // Alternating asymmetric: "one week ... the next"
    const altSplit = text.split(/\bone week\b|\bthe next(?: week)?\b|\balternating week(?:s)?\b|\bevery other week\b/i);
    const isAlternate =
      (/\bone week\b/i.test(text) && /\b(the next|next week|other week)\b/i.test(text)) ||
      /\balternating\b/i.test(text) ||
      /\bevery other week\b/i.test(text);

    const isAltWeekend =
      /\balternating weekends?\b/i.test(text) ||
      /\bevery other weekend\b/i.test(text);

    if (isAltWeekend) {
      const parent = parseParent(text, momLabel, dadLabel) || 'dad';
      return {
        ok: true,
        summary: `Alternating weekends with ${parent === 'mom' ? momLabel : dadLabel} (Sat–Sun). Week A = first weekend on/after start.`,
        config: {
          mode: 'alternate',
          weekA: { days: [6, 0], parent },
          weekB: { days: [6, 0], parent: parent === 'mom' ? 'dad' : 'mom' },
          fillOther: false,
          start,
          end,
          anchor: start,
        },
      };
    }

    if (isAlternate) {
      // Try two day-spans in order
      const spans = [];
      const re = /\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesdays?|s)?|thu(?:rs?|rsday)?|fri(?:day)?|sat(?:urday)?)\b\s*(?:through|thru|to|-|–|—)\s*\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesdays?|s)?|thu(?:rs?|rsday)?|fri(?:day)?|sat(?:urday)?)\b/gi;
      let mm;
      const found = [];
      while ((mm = re.exec(text)) !== null) {
        found.push(expandDowRange(parseDowToken(mm[1]), parseDowToken(mm[2])));
      }

      // Parents near each span — split text around "one week" / "next"
      let partA = text;
      let partB = '';
      const oneWeek = text.search(/\bone week\b/i);
      const nextWeek = text.search(/\b(the next|next week)\b/i);
      if (oneWeek >= 0 && nextWeek > oneWeek) {
        partA = text.slice(0, nextWeek);
        partB = text.slice(nextWeek);
      }

      let daysA = found[0] || parseDaySpan(partA);
      let daysB = found[1] || parseDaySpan(partB) || found[0];

      // Full alternating weeks with one parent named
      if (/\bfull weeks?\b|\bwhole weeks?\b|\bentire weeks?\b/i.test(text) || (!daysA && !daysB)) {
        const p = parseParent(text, momLabel, dadLabel) || 'dad';
        daysA = [0, 1, 2, 3, 4, 5, 6];
        daysB = [0, 1, 2, 3, 4, 5, 6];
        return {
          ok: true,
          summary: `Full alternating weeks: Week A ${p === 'mom' ? momLabel : dadLabel}, Week B ${p === 'mom' ? dadLabel : momLabel}.`,
          config: {
            mode: 'alternate',
            weekA: { days: daysA, parent: p },
            weekB: { days: daysB, parent: p === 'mom' ? 'dad' : 'mom' },
            fillOther: false,
            start,
            end,
            anchor: start,
          },
        };
      }

      if (!daysA || !daysB) {
        return {
          ok: false,
          error: 'Could not find two day ranges. Try: “With Dad Wed–Mon one week and Wed–Fri the next.”',
        };
      }

      let parentA = parseParent(partA, momLabel, dadLabel);
      let parentB = parseParent(partB, momLabel, dadLabel);
      // If only one parent mentioned overall, both stretches are that parent (asymmetric days, same house)
      const overall = parseParent(text, momLabel, dadLabel);
      if (!parentA) parentA = overall || 'dad';
      if (!parentB) parentB = overall || parentA;

      const fillOther = /\b(rest|remaining|other days?|fill the rest)\b/i.test(text);

      return {
        ok: true,
        summary:
          `Week A: ${formatDays(daysA)} → ${parentA === 'mom' ? momLabel : dadLabel}. ` +
          `Week B: ${formatDays(daysB)} → ${parentB === 'mom' ? momLabel : dadLabel}.` +
          (fillOther ? ' Remaining days → other house.' : ''),
        config: {
          mode: 'alternate',
          weekA: { days: daysA, parent: parentA },
          weekB: { days: daysB, parent: parentB },
          fillOther,
          start,
          end,
          anchor: start,
        },
      };
    }

    // Every week same pattern
    const days = parseDaySpan(text);
    const parent = parseParent(text, momLabel, dadLabel) || 'dad';
    if (!days) {
      return {
        ok: false,
        error: 'Could not understand. Examples: “With Dad every Wed–Mon”, “Alternating weeks with Mom”, “With Dad Wed–Mon one week and Wed–Fri the next”.',
      };
    }
    const fillOther = /\b(rest|remaining|other days?|fill the rest)\b/i.test(text);
    return {
      ok: true,
      summary: `Every week: ${formatDays(days)} → ${parent === 'mom' ? momLabel : dadLabel}.`,
      config: {
        mode: 'every',
        every: { days, parent },
        fillOther,
        start,
        end,
        anchor: start,
      },
    };
  }

  /** Overnight owner for a weekday given exchange cuts (outgoing last day = from). */
  function overnightFromHandoffs(dow, cuts) {
    for (let i = 0; i < 7; i++) {
      const d = (dow - i + 7) % 7;
      let hit = null;
      for (let c = 0; c < cuts.length; c++) {
        if (cuts[c].dow === d) { hit = cuts[c]; break; }
      }
      if (!hit) continue;
      return i === 0 ? hit.from : hit.to;
    }
    return null;
  }

  /** Days from leave weekday to return weekday; next week adds 7. */
  function stayLengthDays(leaveDow, returnDow, returnWeek) {
    let span = (returnDow - leaveDow + 7) % 7;
    if (returnWeek === 'next') span += 7;
    if (span === 0) span = returnWeek === 'next' ? 14 : 7;
    return span;
  }

  function overnightFromStay(diffDays, leaveDow, returnDow, from, to, returnWeek) {
    const stay = stayLengthDays(leaveDow, returnDow, returnWeek);
    const cycle = stay + ((leaveDow - returnDow + 7) % 7 || 7);
    const slot = ((diffDays % cycle) + cycle) % cycle;
    if (slot === 0) return from;
    if (slot < stay) return to;
    return from;
  }

  /**
   * @param {object} p
   * @param {(iso:string)=>any} dayMapFn - returns assignment or null
   * @param {(iso:string)=>boolean} isNoSchoolFn
   */
  function expandPattern(p, dayMapFn, isNoSchoolFn, helpers) {
    const { compareISO, eachDate, dateFromISO, startOfWeekDate, toISOFromDate } = helpers;
    const start = p.start;
    const end = p.end;
    if (!start || !end) return { invalid: 'Pick a start and end date.', byParent: { mom: [], dad: [] } };
    if (compareISO(start, end) > 0) return { invalid: 'End date must be on or after start.', byParent: { mom: [], dad: [] } };

    const mode = p.mode || 'every';
    const conflict = p.conflict || 'skip';
    const skipSchool = p.skipSchool !== false;
    const fillOther = !!p.fillOther;
    const byParent = { mom: [], dad: [] };
    let skippedExisting = 0;
    let skippedSchool = 0;

    function pushDay(iso, parent) {
      if (!parent || (parent !== 'mom' && parent !== 'dad')) return;
      const existing = dayMapFn(iso);
      const noSchool = skipSchool && isNoSchoolFn(iso);
      if (noSchool) {
        skippedSchool++;
        return;
      }
      if (conflict === 'skip' && existing) {
        skippedExisting++;
        return;
      }
      byParent[parent].push(iso);
    }

    function weekIsA(iso, anchorIso) {
      const w = startOfWeekDate(dateFromISO(iso)).getTime();
      const a = startOfWeekDate(dateFromISO(anchorIso || start)).getTime();
      const diff = Math.round((w - a) / (7 * 24 * 60 * 60 * 1000));
      return ((diff % 2) + 2) % 2 === 0;
    }

    if (mode === 'stay') {
      const leaveDow = Number(p.leaveDow);
      const returnDow = Number(p.returnDow);
      const from = p.from === 'mom' ? 'mom' : 'dad';
      const to = p.to === 'mom' ? 'mom' : 'dad';
      const returnWeek = p.returnWeek === 'same' ? 'same' : 'next';
      if (from === to) return { invalid: 'Leave and return must go to different houses.', byParent, skippedExisting, skippedSchool };
      if (!(leaveDow >= 0 && leaveDow <= 6 && returnDow >= 0 && returnDow <= 6)) {
        return { invalid: 'Pick leave and return weekdays.', byParent, skippedExisting, skippedSchool };
      }
      const stay = stayLengthDays(leaveDow, returnDow, returnWeek);
      const after = (leaveDow - returnDow + 7) % 7 || 7;
      const cycle = stay + after;
      let origin = dateFromISO(p.anchor || start);
      const shift = (origin.getDay() - leaveDow + 7) % 7;
      origin.setDate(origin.getDate() - shift);
      const originTime = origin.getTime();
      eachDate(start, end, (iso) => {
        const diff = Math.round((dateFromISO(iso).getTime() - originTime) / (24 * 60 * 60 * 1000));
        pushDay(iso, overnightFromStay(diff, leaveDow, returnDow, from, to, returnWeek));
      });
    } else if (mode === 'handoffs') {
      const cuts = (p.handoffs || []).filter((h) => h && (h.from === 'mom' || h.from === 'dad') && (h.to === 'mom' || h.to === 'dad') && h.from !== h.to && h.dow >= 0 && h.dow <= 6);
      if (cuts.length < 2) return { invalid: 'Set two different exchange days.', byParent, skippedExisting, skippedSchool };
      if (cuts[0].dow === cuts[1].dow) return { invalid: 'Exchange days must be different weekdays.', byParent, skippedExisting, skippedSchool };
      eachDate(start, end, (iso) => pushDay(iso, overnightFromHandoffs(dateFromISO(iso).getDay(), cuts)));
    } else if (mode === '223') {
      const first = p.firstParent === 'mom' ? 'mom' : 'dad';
      const second = first === 'mom' ? 'dad' : 'mom';
      const origin = p.anchor || start;
      const originTime = dateFromISO(origin).getTime();
      eachDate(start, end, (iso) => {
        const day = dateFromISO(iso);
        const diff = Math.round((day.getTime() - originTime) / (24 * 60 * 60 * 1000));
        const slot = ((diff % 14) + 14) % 14;
        const parent = (slot < 2 || (slot >= 4 && slot < 7) || (slot >= 9 && slot < 11)) ? first : second;
        pushDay(iso, parent);
      });
    } else if (mode === 'weekly') {
      const nights = p.nights || {};
      eachDate(start, end, (iso) => {
        const parent = nights[dateFromISO(iso).getDay()];
        if (parent === 'mom' || parent === 'dad') pushDay(iso, parent);
      });
    } else if (mode === 'every') {
      const days = new Set(p.every?.days || []);
      const parent = p.every?.parent || 'dad';
      if (!days.size) return { invalid: 'Select at least one weekday.', byParent, skippedExisting, skippedSchool };
      eachDate(start, end, (iso) => {
        const dow = dateFromISO(iso).getDay();
        if (days.has(dow)) pushDay(iso, parent);
        else if (fillOther) pushDay(iso, parent === 'mom' ? 'dad' : 'mom');
      });
    } else if (mode === 'alternate') {
      const aDays = new Set(p.weekA?.days || []);
      const bDays = new Set(p.weekB?.days || []);
      const aParent = p.weekA?.parent || 'dad';
      const bParent = p.weekB?.parent || 'mom';
      if (!aDays.size && !bDays.size) {
        return { invalid: 'Select weekdays for Week A and/or Week B.', byParent, skippedExisting, skippedSchool };
      }
      const anchor = p.anchor || start;
      eachDate(start, end, (iso) => {
        const isA = weekIsA(iso, anchor);
        const days = isA ? aDays : bDays;
        const parent = isA ? aParent : bParent;
        const dow = dateFromISO(iso).getDay();
        if (days.has(dow)) pushDay(iso, parent);
        else if (fillOther) pushDay(iso, parent === 'mom' ? 'dad' : 'mom');
      });
    } else {
      return { invalid: 'Unknown pattern mode.', byParent };
    }

    return { byParent, skippedExisting, skippedSchool, invalid: null };
  }

  global.ScheduleEntry = {
    interpretNaturalLanguage,
    expandPattern,
    overnightFromHandoffs,
    overnightFromStay,
    stayLengthDays,
    expandDowRange,
    parseDaySpan,
    formatDays,
    DOW_SHORT,
  };
})(window);
