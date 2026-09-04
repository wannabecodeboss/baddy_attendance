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
- `leaderboard.html` — ranked boards for attendance and running, filterable by
  season / month / week.
- `totals.html` — every person's season totals plus a team summary.

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
