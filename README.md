# Evening Session — team attendance

Teammates sign in with Google and log their own runs and badminton. Everyone
sees everyone's attendance. No Strava, no API fees, no server.

- **Frontend** (`docs/`): static HTML/CSS/JS on **GitHub Pages**
- **Backend**: **Firebase Auth** (persistent logins) + **Firestore**, talked to
  directly from the browser

Because there's no server secret to protect, there are no Cloud Functions —
this runs entirely on Firebase's **free Spark plan, no credit card**.

## Who can do what

| | View everyone's attendance | Edit own records | Edit anyone's records |
|---|---|---|---|
| Signed-in teammate | yes | yes | no |
| Admin | yes | yes | yes |
| Signed out | no | no | no |

Records are editable for **any date from 31 August onward**, up to today.
Nobody can log a future date, and nobody can log before the season starts.

## 1. Create a Firebase project
1. https://console.firebase.google.com → **Add project**. Skip Google Analytics.
2. **Build → Authentication → Get started → Google → Enable.** Set a support
   email and save.
3. **Build → Firestore Database → Create database → Production mode.** Pick a
   region near your team (e.g. `asia-south1`).
4. **Project settings (gear) → General → Your apps → Web (`</>`)** → register
   an app and copy the `firebaseConfig` object.

## 2. Configure the app
Paste your config into `docs/firebase-config.js`.

These values are **not secrets** — they're designed to ship in client-side
code. Your data is protected by `firestore.rules`, not by hiding them.

Team rules live in the same file:
```js
export const RULES = {
  seasonStart: "2026-08-31",
  minRunKm: 2,
  windowLabel: "6:30–7:30 PM",
  activeDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};
```

**If you change `seasonStart`, change it in `firestore.rules` too** (in the
`inSeason` function) and redeploy the rules. The app and the server both
enforce it, and they have to agree.

## 3. Publish the security rules
Without this, Firestore's default production rules block everything and the
app loads no data.

```bash
npm install -g firebase-tools
firebase login
firebase use --add          # pick your project
firebase deploy --only firestore:rules
```

Or paste `firestore.rules` into **Firestore Database → Rules** and Publish.

## 4. Authorize your GitHub Pages domain
**Authentication → Settings → Authorized domains → Add domain** →
`yourusername.github.io`. Google sign-in fails silently without this.

## 5. Publish the site
Push the repo, then **Settings → Pages → Source: Deploy from branch →
Branch: `main`, Folder: `/docs`**.

Live at `https://yourusername.github.io/repo-name/`. Share it with the team.

## 6. Make yourself an admin
Admins can edit anyone's records. This is granted from the console only —
by design, nobody can grant it to themselves through the app.

1. Sign in to the site once so your user exists.
2. In the Firebase console: **Firestore Database → Start collection** →
   collection id `admins`.
3. Add a document whose **document ID is your Firebase Auth UID** (find it
   under **Authentication → Users → User UID**). The fields don't matter —
   the document's existence is the grant. Add e.g. `name: "Hiteshi"` so the
   list is readable later.
4. Reload the site. The header will read "Admin — you can edit anyone."

Repeat for any co-admin. To revoke, delete the document.

## Pages
- `index.html` — log today, and edit any past day back to 31 August.
- `leaderboard.html` — the **challenge ladder** (see below).
- `totals.html` — every person's season totals plus a team summary.

## The challenge ladder

Two ladders — Men's and Women's — picked once per player at first visit to
`leaderboard.html`. You can't change your own ladder afterward; an admin can.

- Beat someone ranked **within two places** of you and you take the higher
  rank (a straight swap of the two rank numbers). Beat someone below you and
  nothing moves. This holds whoever started the match.
- Either player records the result — opponent, winner, date, and a free-text
  score like `21-15, 19-21, 21-18`. There's no confirmation step: the result
  and the rank swap are trusted and written together in one batch.
- Every player's **played / won / lost** and full dated match history show
  publicly in the dropdown under their name.

Nothing is enforced about *who actually won* — same honour-system trade-off as
attendance. The rules only keep the ladder well-formed: same ladder, ranks
within two, a clean swap, no replays.

### Turning it on
1. Add `gender` onboarding happens automatically the first time each player
   opens the ladder page.
2. As an admin, open `leaderboard.html` → **Admin → Seed unranked** for each
   ladder. This shuffles everyone who has picked a ladder but has no rank yet
   and drops them on the bottom, in random order.
3. Flip `ladderEnabled: true` in `firebase-config.js` and redeploy the site.
   Until then the page shows a short "not open yet" note.
4. New players who join later land in **Not on a ladder yet**; run **Seed
   unranked** again to add them at the bottom.

### Admin controls (on `leaderboard.html`)
- **Seed unranked** / **Normalize** (close gaps to 1…N) / **Reshuffle all**
  per ladder.
- **Edit** on any row — set that player's rank and P/W/L, or remove them from
  the ladder.
- **Delete** on any history line. Note: deleting or editing a match does *not*
  recalculate anyone's counters or ranks — fix those by hand with **Edit**.

## Using it
- **Today** — the two cards at the top are the fast path: enter distance and
  (optionally) time, tap Log run, or tap Log badminton.
- **Run times** are optional. Pace is only shown for runs with a time.
- **Past days** — in the week table, tap any day in your own row to open the
  editor. Admins can tap any day in any row.
- **Navigating** — the arrows move between weeks. They stop at the week
  containing 31 August and at the current week.

Dots: amber for a qualifying run, cyan for badminton, muted for a run under
the minimum distance.

## How logins stay persistent
The app calls `setPersistence(auth, browserLocalPersistence)` before sign-in,
so sessions are stored in localStorage. Teammates stay signed in across
reloads, new tabs, and browser restarts until they tap Sign out. On a phone,
adding the site to the home screen makes it behave like an always-logged-in
app.

## What the rules enforce
- Only signed-in people can read anything; all of them can read everything.
- A log's document id is `{uid}_{date}_{activity}` and must match the data
  inside it, so a record can't be filed under someone who doesn't own it.
- You can write and delete only your own logs — unless you're an admin.
- `/admins` is read-only from the app. Admin is granted in the console only.
- Only `run` and `badminton`; distances 0–200km.
- Dates only from 31 August up to ~today (36 hours of forward slack covers
  timezones without allowing pre-logging next week).
- `gender` on a member doc must be `M` or `F`, and once set only an admin can
  change it.
- `/ranks` is created and freely edited **only by an admin**. The one other
  write is a match result: it must be a batch by one of the two players that
  moves both rank docs as a clean positional swap (or leaves them), bumps
  `played` by exactly one, and carries a match id the doc hasn't seen before
  (so the same result can't be applied twice).
- A `/matches` row must be written by one of its two participants, name a
  winner who is one of them, and pair two players on the same ladder whose
  ranks are within two. Score is a non-empty string ≤ 40 chars. Only an admin
  can edit or delete a match afterward.

## Testing the rules
`rules.test.mjs` covers all of the above, including the abuse cases and the
admin paths.

```bash
npm install --save-dev @firebase/rules-unit-testing firebase firebase-tools
npx firebase emulators:exec --only firestore --project demo-test "node rules.test.mjs"
```
Needs Java installed. **Run this before sharing the link** — the rules are
the only thing standing between your data and the open internet, and they
were not executed when this project was generated.

## Honest limitations
- **Self-logging is honour-system.** Nothing verifies a run happened. The
  rules stop mechanical abuse — you can't write under someone else's name,
  can't log outside the season, can't double-log a day — but a teammate can
  still log a session they skipped. That's the trade-off for dropping Strava.
- The 6:30–7:30 PM window is shown as a reminder, not enforced; people often
  log after they get home.
- Anyone who signs in joins the roster. For a small internal team that's
  usually fine. To restrict it, add an email allowlist to the rules.
