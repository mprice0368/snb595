/* ============================================================
   Store — localStorage persistence + gamification state machine.
   Framework-free, single global `Store`.
   ============================================================ */
const Store = (function () {
  "use strict";
  const KEY = "icc-study-app-v1";

  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function daysBetween(a, b) {
    const da = new Date(a + "T00:00:00");
    const db = new Date(b + "T00:00:00");
    return Math.round((db - da) / 86400000);
  }

  function defaultCert() {
    return {
      xp: 0,
      lastSection: null,
      lastView: "dashboard",
      cards: {},          // cardId -> { state, correctStreak, wrongCount, flippedOnce, manual }
      quizHistory: [],     // [{date, sectionKey, mode, score, total, xp}]
      questionStats: {}    // qId -> { seen, correct, wrong }
    };
  }
  function defaultState() {
    return {
      version: 1,
      streak: { count: 0, longest: 0, lastDate: null },
      certs: { e1: defaultCert(), e2: defaultCert() }
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      const merged = Object.assign({}, base, parsed);
      merged.streak = Object.assign({}, base.streak, parsed.streak || {});
      merged.certs = {};
      ["e1", "e2"].forEach(function (c) {
        merged.certs[c] = Object.assign({}, defaultCert(), (parsed.certs && parsed.certs[c]) || {});
        merged.certs[c].cards = Object.assign({}, (parsed.certs && parsed.certs[c] && parsed.certs[c].cards) || {});
        merged.certs[c].questionStats = Object.assign({}, (parsed.certs && parsed.certs[c] && parsed.certs[c].questionStats) || {});
        merged.certs[c].quizHistory = (parsed.certs && parsed.certs[c] && parsed.certs[c].quizHistory) || [];
      });
      return merged;
    } catch (e) {
      console.warn("Could not read saved progress — starting fresh.", e);
      return defaultState();
    }
  }

  let state = load();
  let saveFailed = false;

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      saveFailed = false;
    } catch (e) {
      if (!saveFailed) console.warn("Could not save progress (storage unavailable/full).", e);
      saveFailed = true;
    }
  }

  function get() { return state; }
  function cert(certId) { return state.certs[certId]; }

  function cardState(certId, cardId) {
    const c = cert(certId);
    if (!c.cards[cardId]) {
      c.cards[cardId] = { state: "new", correctStreak: 0, wrongCount: 0, flippedOnce: false, manual: false };
    }
    return c.cards[cardId];
  }

  function touchStreak() {
    const today = todayStr();
    const s = state.streak;
    if (s.lastDate === today) return { changed: false, count: s.count };
    const diff = s.lastDate ? daysBetween(s.lastDate, today) : null;
    if (diff === 1) s.count += 1;
    else s.count = 1;
    s.lastDate = today;
    if (s.count > s.longest) s.longest = s.count;
    persist();
    return { changed: true, count: s.count };
  }

  // A streak "at risk" flag: studied yesterday but not yet today.
  function streakAtRisk() {
    const s = state.streak;
    if (!s.lastDate) return false;
    const today = todayStr();
    if (s.lastDate === today) return false;
    return daysBetween(s.lastDate, today) === 1;
  }
  function streakBroken() {
    const s = state.streak;
    if (!s.lastDate || s.count === 0) return false;
    const today = todayStr();
    return daysBetween(s.lastDate, today) > 1;
  }

  function flipCard(certId, cardId) {
    const cs = cardState(certId, cardId);
    let xpGained = 0;
    if (!cs.flippedOnce) {
      cs.flippedOnce = true;
      if (cs.state === "new") cs.state = "reviewed";
      xpGained = 2;
      cert(certId).xp += xpGained;
    }
    touchStreak();
    persist();
    return { xpGained: xpGained };
  }

  function recallCard(certId, cardId, gotIt) {
    const cs = cardState(certId, cardId);
    if (gotIt) {
      cs.correctStreak = (cs.correctStreak || 0) + 1;
      if (cs.correctStreak >= 3) cs.state = "mastered";
      else if (cs.state !== "mastered") cs.state = "reviewed";
    } else {
      cs.correctStreak = 0;
      cs.wrongCount = (cs.wrongCount || 0) + 1;
      if (cs.state !== "mastered") cs.state = "reviewed";
    }
    persist();
  }

  function markMastered(certId, cardId) {
    const cs = cardState(certId, cardId);
    cs.state = "mastered";
    cs.manual = true;
    cs.correctStreak = Math.max(cs.correctStreak || 0, 3);
    persist();
  }

  function resetCard(certId, cardId) {
    const c = cert(certId);
    c.cards[cardId] = { state: "new", correctStreak: 0, wrongCount: 0, flippedOnce: false, manual: false };
    persist();
  }

  function recordQuizAnswer(certId, qId, correct) {
    const c = cert(certId);
    if (!c.questionStats[qId]) c.questionStats[qId] = { seen: 0, correct: 0, wrong: 0 };
    const qs = c.questionStats[qId];
    qs.seen += 1;
    let xpGained = 0;
    if (correct) { qs.correct += 1; xpGained = 5; c.xp += 5; }
    else { qs.wrong += 1; }
    touchStreak();
    persist();
    return { xpGained: xpGained };
  }

  function finishQuiz(certId, opts) {
    const c = cert(certId);
    const total = opts.total || 0;
    const correct = opts.correct || 0;
    let bonus = total > 0 ? 20 : 0;
    if (total > 0 && correct === total) bonus += 30;
    c.xp += bonus;
    c.quizHistory.push({
      date: todayStr(),
      sectionKey: opts.sectionKey || null,
      mode: opts.mode || "all",
      score: correct,
      total: total,
      xp: bonus
    });
    if (c.quizHistory.length > 300) c.quizHistory = c.quizHistory.slice(-300);
    persist();
    return { bonus: bonus };
  }

  function setLastSection(certId, sectionKey) {
    cert(certId).lastSection = sectionKey;
    persist();
  }
  function setLastView(certId, view) {
    cert(certId).lastView = view;
    persist();
  }

  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }
  function importJSON(json) {
    try {
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== "object") throw new Error("bad shape");
      state = load.call(null); // fallback structure
      const base = defaultState();
      const merged = Object.assign({}, base, parsed);
      merged.streak = Object.assign({}, base.streak, parsed.streak || {});
      merged.certs = {};
      ["e1", "e2"].forEach(function (c) {
        merged.certs[c] = Object.assign({}, defaultCert(), (parsed.certs && parsed.certs[c]) || {});
      });
      state = merged;
      persist();
      return true;
    } catch (e) {
      console.warn("Import failed", e);
      return false;
    }
  }
  function resetAll() {
    state = defaultState();
    persist();
  }

  return {
    get: get,
    cert: cert,
    cardState: cardState,
    touchStreak: touchStreak,
    streakAtRisk: streakAtRisk,
    streakBroken: streakBroken,
    flipCard: flipCard,
    recallCard: recallCard,
    markMastered: markMastered,
    resetCard: resetCard,
    recordQuizAnswer: recordQuizAnswer,
    finishQuiz: finishQuiz,
    setLastSection: setLastSection,
    setLastView: setLastView,
    exportJSON: exportJSON,
    importJSON: importJSON,
    resetAll: resetAll,
    todayStr: todayStr
  };
})();
