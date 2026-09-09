# ICC Crash Course — E1 / E2 Electrical Inspector

A combined, offline-friendly study app for the ICC **E1 (Residential)** and
**E2 (Commercial) Electrical Inspector** exams — flashcards, a calculation
reference, and scenario-based quizzes for both certs in one app, with your
progress, streak, and XP saved locally between sessions.

No build step, no dependencies, no server required to use it.

## Run it locally

**Simplest — just open the file:**

Double-click `index.html` (or open it with your browser's File → Open).
Everything works fully offline this way: flashcards, quizzes, the
calculation reference, and saved progress. The only thing that *won't*
work from a plain `file://` page is installing it as an app (browsers
require a real server, even a local one, for that).

**To also enable "Install as app":**

From this folder, run a tiny local server, e.g.:

```bash
python3 -m http.server 8080
# then open http://localhost:8080 in your browser
```

or, with Node installed:

```bash
npx serve .
```

Then open the printed `localhost` URL. Chrome/Edge on desktop will offer
an install icon in the address bar; on Android, the browser menu will
offer "Install app" / "Add to Home screen".

## Installing on your phone

The PWA install prompt (and the service worker that lets it launch
offline) only activates over HTTPS or `localhost` — that's a browser
security requirement, not something this app can opt out of. To install
it on your phone as a home-screen app:

1. Host the folder somewhere with HTTPS — the free tiers of GitHub Pages,
   Netlify, Vercel, or Cloudflare Pages all work with zero config for a
   static site like this one; just deploy the repo root.
2. Open that HTTPS URL on your phone.
3. iOS Safari: Share → **Add to Home Screen**.
   Android Chrome: menu (⋮) → **Install app** (or you'll see an automatic
   install banner).

Once installed, it opens full-screen with no browser chrome, and works
offline after the first load — the service worker caches the app shell,
and study progress lives in your browser's local storage on that device.

## How progress is stored

Everything — flashcard mastery, quiz history, XP, streak — is saved in
`localStorage`, scoped to wherever the app is hosted/opened from. That
means:

- It's **per-browser, per-device**. Progress made on your phone won't
  automatically show up on your laptop unless you host it at the same
  URL and use the same browser.
- Clearing site data / browsing data for the app will erase progress.
- Use **Export progress** (bottom of the landing screen) any time to
  download a JSON backup.

## Project layout

```
index.html          App shell (loads everything below)
css/styles.css       Dark theme, IBM Plex Sans/Mono, copper (E1) / blue (E2) accents
js/store.js          localStorage persistence + gamification rules (XP, streak, mastery)
js/app.js            Router + screen rendering + event handling
data/data-e1.js       E1 flashcards, calculation reference, and quiz bank
data/data-e2.js       E2 flashcards, calculation reference, and quiz bank
manifest.json        PWA manifest
service-worker.js    Offline app-shell caching
icons/               App icons (SVG favicon + PNG icons for install/home screen)
```

## What's in the study content

Both certs cover well-established NEC/IRC concepts organized into the
same section structure the exams use (services, grounding & bonding,
branch circuits, overcurrent protection, wiring methods, special
occupancies, calculations, etc.), with scenario-style quiz questions
rather than pure definition recall.

**This is a study aid, not a code reference for fieldwork.** Always
verify against the code edition actually adopted in your jurisdiction —
NEC/IRC provisions get renumbered and revised between cycles.

## Gamification, briefly

- **Streak** — consecutive days you've studied (flipped a card or
  answered a quiz question), shown on the landing screen.
- **XP** — +2 for the first flip of a new card, +5 per correct quiz
  answer, +20 for finishing a quiz (+30 more for a perfect run).
- **Mastery** — each card moves New → Reviewed → Mastered based on
  getting it right three times via the "Got it" / "Still learning"
  buttons after flipping — or mark it mastered manually if you already
  know it cold.
- **Section progress** — a bar + "Complete" badge per section once every
  card in it is mastered.
- **Weak Spots** — a dedicated view surfacing the flashcards and quiz
  questions you've missed most, with one-tap drills for just those.
