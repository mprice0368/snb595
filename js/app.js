/* ============================================================
   ICC Crash Course — app shell, router, and screen rendering.
   Vanilla JS, no build step. Data comes from window.E1_DATA /
   window.E2_DATA; persistence + gamification rules live in Store
   (js/store.js).
   ============================================================ */
(function () {
  "use strict";

  const CERTS = { e1: window.E1_DATA, e2: window.E2_DATA };
  const app = document.getElementById("app");

  // ---- ephemeral (non-persisted) session state ----
  let fc = null;          // current flashcard session {certId, sectionKey, cardIds, index, flipped}
  let quizSession = null; // current quiz session
  let deferredInstallPrompt = null;

  // ================= data helpers =================
  function cardsBySection(certId, key) { return CERTS[certId].cards.filter(function (c) { return c.section === key; }); }
  function allCardIds(certId) { return CERTS[certId].cards.map(function (c) { return c.id; }); }
  function findCard(certId, id) { return CERTS[certId].cards.find(function (c) { return c.id === id; }); }
  function findQuestion(certId, id) { return CERTS[certId].quiz.find(function (q) { return q.id === id; }); }
  function sectionLabel(certId, key) {
    const s = CERTS[certId].sections.find(function (s) { return s.key === key; });
    return s ? s.label : key;
  }
  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }

  function sectionStats(certId, key) {
    const cards = cardsBySection(certId, key);
    const cs = Store.cert(certId).cards;
    let reviewed = 0, mastered = 0;
    cards.forEach(function (c) {
      const st = cs[c.id];
      if (st) { if (st.state === "mastered") mastered++; else if (st.state === "reviewed") reviewed++; }
    });
    return { total: cards.length, reviewed: reviewed, mastered: mastered };
  }
  function overallStats(certId) {
    const cards = CERTS[certId].cards;
    const cs = Store.cert(certId).cards;
    let reviewed = 0, mastered = 0;
    cards.forEach(function (c) {
      const st = cs[c.id];
      if (st) { if (st.state === "mastered") mastered++; else if (st.state === "reviewed") reviewed++; }
    });
    return { total: cards.length, reviewed: reviewed, mastered: mastered };
  }
  function weakCards(certId, limit) {
    const cs = Store.cert(certId).cards;
    const arr = Object.keys(cs).map(function (id) { return Object.assign({ id: id }, cs[id]); })
      .filter(function (x) { return x.wrongCount > 0; });
    arr.sort(function (a, b) { return b.wrongCount - a.wrongCount; });
    return arr.slice(0, limit || 10)
      .map(function (x) { return { stat: x, card: findCard(certId, x.id) }; })
      .filter(function (x) { return x.card; });
  }
  function weakQuestions(certId, limit) {
    const qs = Store.cert(certId).questionStats;
    const arr = Object.keys(qs).map(function (id) { return Object.assign({ id: id }, qs[id]); })
      .filter(function (x) { return x.wrong > 0; });
    arr.sort(function (a, b) { return b.wrong - a.wrong; });
    return arr.slice(0, limit || 10)
      .map(function (x) { return { stat: x, q: findQuestion(certId, x.id) }; })
      .filter(function (x) { return x.q; });
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ================= router =================
  function parseHash() {
    return location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  }
  function navigate(path) {
    // Setting location.hash to its current value doesn't fire "hashchange",
    // so force a render directly rather than relying on the event alone.
    location.hash = path;
    render();
  }

  function render() {
    const parts = parseHash();
    if (parts.length === 0) {
      document.body.removeAttribute("data-accent");
      app.innerHTML = screenLanding();
      window.scrollTo(0, 0);
      return;
    }
    const certId = parts[0];
    if (certId !== "e1" && certId !== "e2") { navigate(""); return; }
    document.body.setAttribute("data-accent", CERTS[certId].accent);
    const view = parts[1] || "dashboard";
    Store.setLastView(certId, view);

    if (view === "dashboard") {
      app.innerHTML = screenDashboard(certId);
    } else if (view === "cards") {
      const sectionParam = parts[2] || Store.cert(certId).lastSection || "all";
      if (!fc || fc.certId !== certId || fc.sectionKey !== sectionParam) {
        fc = buildFlashcardSession(certId, sectionParam);
      }
      Store.setLastSection(certId, sectionParam);
      app.innerHTML = screenFlashcards(certId);
    } else if (view === "calc") {
      app.innerHTML = screenCalc(certId);
    } else if (view === "quiz") {
      const preset = parts[2];
      if (preset && (!quizSession || quizSession.certId !== certId)) {
        if (preset === "weak") startQuiz(certId, "weak", null);
        else startQuiz(certId, "section", preset);
      }
      app.innerHTML = screenQuiz(certId);
    } else if (view === "weak") {
      app.innerHTML = screenWeakSpots(certId);
    } else {
      app.innerHTML = screenDashboard(certId);
    }
    window.scrollTo(0, 0);
  }

  // ================= flashcard session =================
  function buildFlashcardSession(certId, sectionKey) {
    let ids;
    if (sectionKey === "all") ids = allCardIds(certId);
    else if (sectionKey === "weak") ids = weakCards(certId, 999).map(function (w) { return w.card.id; });
    else ids = cardsBySection(certId, sectionKey).map(function (c) { return c.id; });
    return { certId: certId, sectionKey: sectionKey, cardIds: ids, index: 0, flipped: false };
  }
  function advanceCard(certId) {
    fc.index += 1;
    fc.flipped = false;
    render();
  }

  // ================= quiz session =================
  function startQuiz(certId, mode, sectionKey) {
    let ids;
    if (mode === "all") ids = CERTS[certId].quiz.map(function (q) { return q.id; });
    else if (mode === "section") ids = CERTS[certId].quiz.filter(function (q) { return q.section === sectionKey; }).map(function (q) { return q.id; });
    else ids = weakQuestions(certId, 999).map(function (w) { return w.q.id; });
    ids = shuffle(ids.slice());
    if (ids.length === 0) {
      quizSession = null;
      toast("No questions available for that yet.");
      return;
    }
    quizSession = { certId: certId, mode: mode, sectionKey: sectionKey || null, questions: ids, index: 0, correctCount: 0, selected: null, answered: false, finished: false, bonus: 0 };
  }
  function answerQuiz(certId, choiceIdx) {
    if (!quizSession || quizSession.answered) return;
    const q = findQuestion(certId, quizSession.questions[quizSession.index]);
    quizSession.answered = true;
    quizSession.selected = choiceIdx;
    const correct = choiceIdx === q.correctIndex;
    if (correct) quizSession.correctCount += 1;
    const res = Store.recordQuizAnswer(certId, q.id, correct);
    if (res.xpGained) toast("+" + res.xpGained + " XP");
    render();
  }
  function nextQuizQuestion(certId) {
    quizSession.index += 1;
    quizSession.answered = false;
    quizSession.selected = null;
    if (quizSession.index >= quizSession.questions.length) {
      quizSession.finished = true;
      const res = Store.finishQuiz(certId, {
        total: quizSession.questions.length,
        correct: quizSession.correctCount,
        sectionKey: quizSession.sectionKey,
        mode: quizSession.mode
      });
      quizSession.bonus = res.bonus;
      toast("Quiz complete +" + res.bonus + " XP");
    }
    render();
  }

  // ================= toast =================
  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1500);
  }

  // ================= shared UI fragments =================
  function progressBar(mastered, reviewed, total) {
    const mPct = pct(mastered, total);
    const rPct = pct(mastered + reviewed, total);
    return '<div class="pbar" role="progressbar" aria-valuenow="' + mPct + '" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="pbar-track"><div class="pbar-reviewed" style="width:' + rPct + '%"></div>' +
      '<div class="pbar-mastered" style="width:' + mPct + '%"></div></div></div>';
  }
  function stateBadge(stateVal) {
    const map = { "new": "New", "reviewed": "Reviewed", "mastered": "Mastered" };
    return '<span class="badge badge-' + stateVal + '">' + map[stateVal] + "</span>";
  }
  function topNav(certId, active) {
    const cert = CERTS[certId];
    function item(view, label) {
      return '<a class="tab' + (active === view ? " tab-active" : "") + '" data-action="go" data-href="/' + certId + '/' + view + '">' + label + "</a>";
    }
    return '<nav class="topnav">' +
      '<a class="back-link" data-action="go" data-href="/">&larr; All certs</a>' +
      '<div class="tabs">' +
      item("dashboard", "Dashboard") +
      item("cards", "Flashcards") +
      item("calc", "Reference") +
      item("quiz", "Quiz") +
      item("weak", "Weak Spots") +
      "</div></nav>";
  }
  function xpLine(certId) {
    return '<div class="xp-pill"><span class="xp-num">' + Store.cert(certId).xp + '</span><span class="xp-label">XP</span></div>';
  }

  // ================= screens =================
  function screenLanding() {
    const s = Store.get();
    const streakCount = Store.streakBroken() ? 0 : s.streak.count;
    const atRisk = Store.streakAtRisk();
    const totalXP = s.certs.e1.xp + s.certs.e2.xp;

    function certCard(id) {
      const c = CERTS[id];
      const st = overallStats(id);
      const pctDone = pct(st.mastered, st.total);
      const started = st.reviewed + st.mastered > 0;
      return '<div class="cert-card cert-' + c.accent + '" data-action="go" data-href="/' + id + '" tabindex="0" role="button">' +
        '<div class="cert-card-top"><h2>' + c.certId.toUpperCase() + "</h2>" + (started ? '<span class="xp-mini">' + Store.cert(id).xp + " XP</span>" : "") + "</div>" +
        '<p class="cert-card-name">' + c.certName.replace(/^E[12]\s*—\s*/, "") + "</p>" +
        progressBar(st.mastered, st.reviewed, st.total) +
        '<div class="cert-card-meta">' + pctDone + "% mastered &middot; " + st.total + " cards</div>" +
        '<div class="cert-card-cta">' + (started ? "Continue →" : "Start studying →") + "</div>" +
        "</div>";
    }

    return '<div class="screen landing">' +
      '<header class="landing-header"><h1>ICC Crash Course</h1><p class="tagline">Residential &amp; Commercial Electrical Inspector study companion</p></header>' +
      '<div class="streak-block">' +
      '<div class="streak-num">' + streakCount + "</div>" +
      '<div class="streak-label">day streak' + (s.streak.longest > streakCount ? ' <span class="streak-best">(best ' + s.streak.longest + ")</span>" : "") + "</div>" +
      (atRisk ? '<div class="streak-risk">Study today to keep it alive</div>' : "") +
      "</div>" +
      '<div class="cert-grid">' + certCard("e1") + certCard("e2") + "</div>" +
      (totalXP > 0 ? '<div class="landing-total-xp">' + totalXP + " total XP across both certs</div>" : "") +
      '<footer class="landing-footer">' +
      '<p class="disclaimer">Study aid only — always verify against the code edition adopted in your jurisdiction.</p>' +
      '<div class="data-tools">' +
      '<button class="linklike" data-action="export-data">Export progress</button>' +
      '<button class="linklike" data-action="reset-progress">Reset progress</button>' +
      (deferredInstallPrompt ? '<button class="linklike" data-action="install-app">Install app</button>' : "") +
      "</div></footer>" +
      "</div>";
  }

  function screenDashboard(certId) {
    const cert = CERTS[certId];
    const st = overallStats(certId);
    const weak = weakCards(certId, 999).length + weakQuestions(certId, 999).length;
    const lastSection = Store.cert(certId).lastSection || "all";

    const sectionRows = cert.sections.map(function (sec) {
      const ss = sectionStats(certId, sec.key);
      const complete = ss.total > 0 && ss.mastered === ss.total;
      return '<div class="section-row" data-action="go" data-href="/' + certId + '/cards/' + sec.key + '">' +
        '<div class="section-row-top"><span class="section-label">' + esc(sec.label) + "</span>" +
        (complete ? '<span class="badge badge-mastered">Complete</span>' : '<span class="section-count">' + ss.mastered + "/" + ss.total + "</span>") +
        "</div>" + progressBar(ss.mastered, ss.reviewed, ss.total) + "</div>";
    }).join("");

    return '<div class="screen dashboard">' + topNav(certId, "dashboard") +
      '<header class="dash-header"><h1>' + cert.certName + "</h1>" + xpLine(certId) + "</header>" +
      '<p class="code-refs">' + esc(cert.codeRefs) + "</p>" +
      '<div class="quick-actions">' +
      '<button class="btn btn-accent" data-action="go" data-href="/' + certId + '/cards/' + lastSection + '">Continue flashcards</button>' +
      '<button class="btn" data-action="go" data-href="/' + certId + '/quiz">Take a quiz</button>' +
      '<button class="btn" data-action="go" data-href="/' + certId + '/calc">Reference</button>' +
      (weak > 0 ? '<button class="btn btn-warn" data-action="go" data-href="/' + certId + '/weak">Weak spots (' + weak + ")</button>" : "") +
      "</div>" +
      '<h3 class="section-heading">Sections</h3>' +
      '<div class="section-list">' + sectionRows + "</div>" +
      "</div>";
  }

  function screenFlashcards(certId) {
    const cert = CERTS[certId];
    const chips = [{ key: "all", label: "All" }].concat(cert.sections).map(function (s) {
      return '<button class="chip' + (fc.sectionKey === s.key ? " chip-active" : "") + '" data-action="fc-section" data-cert="' + certId + '" data-section="' + s.key + '">' + esc(s.label) + "</button>";
    }).join("");

    if (fc.cardIds.length === 0) {
      return '<div class="screen flashcards">' + topNav(certId, "cards") +
        '<div class="chip-row">' + chips + "</div>" +
        '<div class="empty-state">No cards here yet' + (fc.sectionKey === "weak" ? " — no weak cards. Nice." : ".") + "</div></div>";
    }

    if (fc.index >= fc.cardIds.length) {
      const ss = fc.sectionKey === "all" ? overallStats(certId) : (fc.sectionKey === "weak" ? null : sectionStats(certId, fc.sectionKey));
      return '<div class="screen flashcards">' + topNav(certId, "cards") +
        '<div class="chip-row">' + chips + "</div>" +
        '<div class="empty-state"><p>Stack complete — ' + fc.cardIds.length + " card" + (fc.cardIds.length === 1 ? "" : "s") + " reviewed this pass.</p>" +
        (ss ? "<p>" + ss.mastered + "/" + ss.total + " mastered so far.</p>" : "") +
        '<button class="btn btn-accent" data-action="fc-restart" data-cert="' + certId + '">Go again</button> ' +
        '<button class="btn" data-action="go" data-href="/' + certId + '/dashboard">Back to dashboard</button>' +
        "</div></div>";
    }

    const cardId = fc.cardIds[fc.index];
    const card = findCard(certId, cardId);
    const cs = Store.cardState(certId, cardId);
    const progress = (fc.index + 1) + " / " + fc.cardIds.length;

    let body;
    if (!fc.flipped) {
      body = '<div class="flashcard" data-action="fc-flip" data-cert="' + certId + '" tabindex="0" role="button" aria-label="Flip card">' +
        '<div class="flashcard-topline">' + stateBadge(cs.state) + '<span class="section-tag">' + esc(sectionLabel(certId, card.section)) + "</span></div>" +
        '<div class="flashcard-face"><p class="flashcard-text">' + esc(card.front) + "</p></div>" +
        '<div class="flashcard-hint">Tap to flip</div>' +
        "</div>";
    } else {
      body = '<div class="flashcard flashcard-flipped">' +
        '<div class="flashcard-topline">' + stateBadge(cs.state) + '<span class="section-tag">' + esc(sectionLabel(certId, card.section)) + "</span></div>" +
        '<div class="flashcard-face"><p class="flashcard-text flashcard-answer">' + esc(card.back) + "</p></div>" +
        '<div class="recall-row">' +
        '<button class="btn btn-recall-no" data-action="fc-recall" data-cert="' + certId + '" data-correct="0">✕ Still learning</button>' +
        '<button class="btn btn-recall-yes" data-action="fc-recall" data-cert="' + certId + '" data-correct="1">✓ Got it</button>' +
        "</div>" +
        (cs.state !== "mastered" ? '<button class="linklike small" data-action="fc-master" data-cert="' + certId + '">Mark as mastered</button>' : "") +
        "</div>";
    }

    return '<div class="screen flashcards">' + topNav(certId, "cards") +
      '<div class="chip-row">' + chips + "</div>" +
      '<div class="fc-progress">' + progress + "</div>" +
      body +
      '<div class="fc-nav">' +
      '<button class="btn" data-action="fc-prev" data-cert="' + certId + '"' + (fc.index === 0 ? " disabled" : "") + ">&larr; Prev</button>" +
      '<button class="btn" data-action="fc-next" data-cert="' + certId + '">Skip &rarr;</button>' +
      "</div></div>";
  }

  function screenCalc(certId) {
    const cert = CERTS[certId];
    const rows = cert.calcRef.map(function (r) {
      return '<div class="calc-card">' +
        '<h3>' + esc(r.title) + "</h3>" +
        '<div class="calc-formula">' + esc(r.formula) + "</div>" +
        '<p class="calc-notes">' + esc(r.notes) + "</p>" +
        "</div>";
    }).join("");
    return '<div class="screen calc">' + topNav(certId, "calc") +
      "<h1>Calculation Reference</h1>" +
      '<p class="subtitle">Core formulas &amp; demand tables for ' + cert.certId.toUpperCase() + " calculations.</p>" +
      '<div class="calc-grid">' + rows + "</div></div>";
  }

  function screenQuiz(certId) {
    const cert = CERTS[certId];
    if (quizSession && quizSession.certId === certId) {
      if (quizSession.finished) return screenQuizSummary(certId);
      return screenQuizActive(certId);
    }
    // picker
    const history = Store.cert(certId).quizHistory.slice(-5).reverse();
    const weakQCount = weakQuestions(certId, 999).length;
    const sectionOptions = cert.sections.map(function (s) {
      return '<button class="btn btn-block" data-action="quiz-start" data-cert="' + certId + '" data-mode="section" data-section="' + s.key + '">' + esc(s.label) + "</button>";
    }).join("");
    return '<div class="screen quiz">' + topNav(certId, "quiz") +
      "<h1>Scenario Quiz</h1>" +
      '<div class="quiz-picker">' +
      '<button class="btn btn-accent btn-block" data-action="quiz-start" data-cert="' + certId + '" data-mode="all">Full mixed quiz (' + cert.quiz.length + " questions)</button>" +
      (weakQCount > 0 ? '<button class="btn btn-warn btn-block" data-action="quiz-start" data-cert="' + certId + '" data-mode="weak">Drill weak spots (' + weakQCount + " questions)</button>" : "") +
      '<h3 class="section-heading">By section</h3>' +
      sectionOptions +
      "</div>" +
      (history.length ? '<h3 class="section-heading">Recent attempts</h3><div class="history-list">' +
        history.map(function (h) {
          return '<div class="history-row"><span>' + (h.sectionKey ? esc(sectionLabel(certId, h.sectionKey)) : (h.mode === "weak" ? "Weak drill" : "Full quiz")) + "</span><span>" + h.score + "/" + h.total + "</span></div>";
        }).join("") + "</div>" : "") +
      "</div>";
  }

  function screenQuizActive(certId) {
    const q = findQuestion(certId, quizSession.questions[quizSession.index]);
    const progress = (quizSession.index + 1) + " / " + quizSession.questions.length;
    const choices = q.choices.map(function (choice, i) {
      let cls = "choice";
      if (quizSession.answered) {
        if (i === q.correctIndex) cls += " choice-correct";
        else if (i === quizSession.selected) cls += " choice-wrong";
        else cls += " choice-disabled";
      }
      return '<button class="' + cls + '" data-action="quiz-answer" data-cert="' + certId + '" data-choice="' + i + '"' + (quizSession.answered ? " disabled" : "") + ">" + esc(choice) + "</button>";
    }).join("");
    return '<div class="screen quiz">' + topNav(certId, "quiz") +
      '<div class="quiz-progress">' + progress + '<button class="linklike small quiz-exit" data-action="quiz-exit" data-cert="' + certId + '">Exit quiz</button></div>' +
      '<div class="quiz-card"><p class="quiz-scenario">' + esc(q.scenario) + "</p><p class=\"quiz-question\">" + esc(q.question) + "</p></div>" +
      '<div class="choice-list">' + choices + "</div>" +
      (quizSession.answered ? '<div class="quiz-explain"><strong>' + (quizSession.selected === q.correctIndex ? "Correct. " : "Not quite. ") + "</strong>" + esc(q.explain) + "</div>" +
        '<button class="btn btn-accent btn-block" data-action="quiz-next" data-cert="' + certId + '">' + (quizSession.index + 1 >= quizSession.questions.length ? "See results" : "Next question") + "</button>" : "") +
      "</div>";
  }

  function screenQuizSummary(certId) {
    const total = quizSession.questions.length;
    const correct = quizSession.correctCount;
    const p = pct(correct, total);
    return '<div class="screen quiz">' + topNav(certId, "quiz") +
      '<div class="quiz-summary">' +
      "<h1>" + correct + " / " + total + "</h1>" +
      '<p class="quiz-summary-pct">' + p + "% correct</p>" +
      '<p class="quiz-summary-xp">+' + quizSession.bonus + " bonus XP" + (p === 100 ? " (perfect run!)" : "") + "</p>" +
      '<button class="btn btn-accent" data-action="quiz-retry" data-cert="' + certId + '">Retake</button> ' +
      '<button class="btn" data-action="quiz-exit" data-cert="' + certId + '">Choose another quiz</button> ' +
      '<button class="btn" data-action="go" data-href="/' + certId + '/dashboard">Back to dashboard</button>' +
      "</div></div>";
  }

  function screenWeakSpots(certId) {
    const wc = weakCards(certId, 12);
    const wq = weakQuestions(certId, 12);
    return '<div class="screen weak">' + topNav(certId, "weak") +
      "<h1>Weak Spots</h1>" +
      '<p class="subtitle">What’s costing you points — drill this instead of everything.</p>' +
      "<h3 class=\"section-heading\">Flashcards you keep missing</h3>" +
      (wc.length ? '<div class="weak-list">' + wc.map(function (w) {
        return '<div class="weak-row"><span class="weak-text">' + esc(w.card.front) + '</span><span class="weak-count">' + w.stat.wrongCount + "&times; missed</span></div>";
      }).join("") + '</div><button class="btn btn-accent" data-action="go" data-href="/' + certId + '/cards/weak">Study these cards →</button>' :
        '<div class="empty-state small">No struggling cards yet — keep going.</div>') +
      "<h3 class=\"section-heading\">Quiz topics missed most</h3>" +
      (wq.length ? '<div class="weak-list">' + wq.map(function (w) {
        return '<div class="weak-row"><span class="weak-text">' + esc(sectionLabel(certId, w.q.section)) + ": " + esc(w.q.question) + '</span><span class="weak-count">' + w.stat.wrong + "&times; missed</span></div>";
      }).join("") + '</div><button class="btn btn-warn" data-action="go" data-href="/' + certId + '/quiz/weak">Drill these →</button>' :
        '<div class="empty-state small">No missed quiz questions yet.</div>') +
      "</div>";
  }

  // ================= data tools =================
  function exportData() {
    const blob = new Blob([Store.exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "icc-crash-course-progress.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("Progress exported");
  }
  function resetProgress() {
    if (!confirm("Reset ALL saved progress for both E1 and E2? This can't be undone.")) return;
    Store.resetAll();
    fc = null; quizSession = null;
    toast("Progress reset");
    render();
  }

  // ================= event delegation =================
  document.body.addEventListener("click", function (e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;
    const certId = el.dataset.cert;
    switch (action) {
      case "go":
        navigate(el.dataset.href);
        break;
      case "fc-section":
        navigate("/" + certId + "/cards/" + el.dataset.section);
        break;
      case "fc-flip": {
        fc.flipped = true;
        const cardId = fc.cardIds[fc.index];
        const res = Store.flipCard(certId, cardId);
        if (res.xpGained) toast("+" + res.xpGained + " XP");
        render();
        break;
      }
      case "fc-recall": {
        const cardId = fc.cardIds[fc.index];
        Store.recallCard(certId, cardId, el.dataset.correct === "1");
        advanceCard(certId);
        break;
      }
      case "fc-master": {
        const cardId = fc.cardIds[fc.index];
        Store.markMastered(certId, cardId);
        toast("Marked mastered");
        advanceCard(certId);
        break;
      }
      case "fc-next": advanceCard(certId); break;
      case "fc-prev":
        fc.index = Math.max(0, fc.index - 1);
        fc.flipped = false;
        render();
        break;
      case "fc-restart":
        fc.index = 0; fc.flipped = false;
        render();
        break;
      case "quiz-start":
        startQuiz(certId, el.dataset.mode, el.dataset.section);
        render();
        break;
      case "quiz-answer":
        answerQuiz(certId, parseInt(el.dataset.choice, 10));
        break;
      case "quiz-next":
        nextQuizQuestion(certId);
        break;
      case "quiz-retry": {
        const m = quizSession.mode, sk = quizSession.sectionKey;
        startQuiz(certId, m, sk);
        render();
        break;
      }
      case "quiz-exit":
        quizSession = null;
        navigate("/" + certId + "/quiz");
        break;
      case "export-data": exportData(); break;
      case "reset-progress": resetProgress(); break;
      case "install-app":
        if (deferredInstallPrompt) {
          deferredInstallPrompt.prompt();
          deferredInstallPrompt.userChoice.finally(function () { deferredInstallPrompt = null; render(); });
        }
        break;
    }
  });

  document.body.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = document.activeElement;
    if (el && el.dataset && el.dataset.action) {
      e.preventDefault();
      el.click();
    }
  });

  // ================= PWA =================
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (!location.hash || location.hash === "#/") render();
  });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js").catch(function (err) {
        console.warn("Service worker registration failed:", err);
      });
    });
  }

  // ================= init =================
  window.addEventListener("hashchange", render);
  window.addEventListener("DOMContentLoaded", render);
  render();
})();
