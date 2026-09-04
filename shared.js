// Shared between index.html and leaderboard.html.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { firebaseConfig, RULES } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { RULES, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged };

export const el = (id) => document.getElementById(id);
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const ACTIVITIES = ["run", "badminton"];

// Sessions persist in localStorage until the user explicitly signs out.
export const ready = setPersistence(auth, browserLocalPersistence);

/* ---------- dates (viewer's local timezone) ---------- */

export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function mondayOf(dateStr) {
  const d = dateStr ? parseDateStr(dateStr) : new Date();
  const shift = (d.getDay() === 0 ? -6 : 1) - d.getDay();
  d.setDate(d.getDate() + shift);
  return toDateStr(d);
}

export function addDays(dateStr, n) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export const today = () => toDateStr(new Date());
export const firstWeek = () => mondayOf(RULES.seasonStart);
export const inSeason = (date) => date >= RULES.seasonStart && date <= today();
export const isActiveDay = (date) =>
  RULES.activeDays.includes(DAY_NAMES[parseDateStr(date).getDay()]);

/** Every date from `from` to `to` inclusive. */
export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const logId = (uid, date, activity) => `${uid}_${date}_${activity}`;

/* ---------- formatting ---------- */

/** 1830 → "30:30", 4210 → "1:10:10". Returns "—" for nothing. */
export function fmtDuration(sec) {
  if (!sec || sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** Minutes per km, as "5:42". Needs both a time and a distance. */
export function fmtPace(sec, km) {
  if (!sec || !km || km <= 0) return "—";
  const paceSec = sec / km;
  const m = Math.floor(paceSec / 60);
  const s = Math.round(paceSec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const fmtKm = (km) => (km ? `${km.toFixed(1)}km` : "—");

/* ---------- shared auth shell ---------- */

/**
 * Wires the sign-in screen and boot state that both pages share.
 * Calls onReady(user) once a signed-in user is available.
 */
export function mountAuth(onReady) {
  el("signin-btn").addEventListener("click", async () => {
    el("signin-error").textContent = "";
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      el("signin-error").textContent =
        err.code === "auth/popup-blocked"
          ? "Your browser blocked the sign-in popup. Allow popups for this site and try again."
          : `Sign-in failed: ${err.message}`;
    }
  });

  el("signout-btn").addEventListener("click", () => signOut(auth));

  onAuthStateChanged(auth, async (user) => {
    el("boot").classList.add("hidden");
    if (!user) {
      el("app-view").classList.add("hidden");
      el("signin-view").classList.remove("hidden");
      return;
    }
    el("signin-view").classList.add("hidden");
    el("app-view").classList.remove("hidden");
    await onReady(user);
  });
}

/* ---------- season data + stats (used by the leaderboard and totals pages) ---------- */

/**
 * Loads every member and every log between two dates.
 * Small team, one season — a couple of collection reads is fine.
 */
export async function loadSeasonData(db, firestore, from, to) {
  const { collection, query, where, getDocs } = firestore;
  const [memberSnap, logSnap] = await Promise.all([
    getDocs(collection(db, "members")),
    getDocs(query(collection(db, "logs"), where("date", ">=", from), where("date", "<=", to))),
  ]);
  return {
    members: memberSnap.docs.map((d) => d.data()),
    logs: logSnap.docs.map((d) => d.data()),
  };
}

/** How many scheduled session days have happened in a range. */
export function activeDaysElapsed(from, to) {
  return dateRange(from, to).filter(isActiveDay).length;
}

/* ---------- challenge ladder ---------- */

/**
 * Everything the ladder page needs: the roster (for names + who's unranked),
 * the rank docs, and the full match history. Three small collection reads —
 * same "one team, one season" assumption as loadSeasonData.
 */
export async function loadLadders(db, firestore) {
  const { collection, getDocs } = firestore;
  const [memberSnap, rankSnap, matchSnap] = await Promise.all([
    getDocs(collection(db, "members")),
    getDocs(collection(db, "ranks")),
    getDocs(collection(db, "matches")),
  ]);
  return {
    members: memberSnap.docs.map((d) => d.data()),
    ranks: rankSnap.docs.map((d) => d.data()),
    matches: matchSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

/** Matches that involve `uid`, newest first. */
export function matchesFor(uid, matches) {
  return matches
    .filter((m) => m.participants?.includes(uid))
    .sort((a, b) =>
      (b.playedOn || "").localeCompare(a.playedOn || "") ||
      (b.createdAtMs || 0) - (a.createdAtMs || 0)
    );
}

/**
 * Per-person totals. A run only counts toward attendance once it clears
 * RULES.minRunKm — but every run's distance and time still count toward the
 * running totals, so a short run isn't erased.
 */
export function buildStats(members, logs) {
  const stats = new Map();

  for (const m of members) {
    stats.set(m.uid, {
      uid: m.uid,
      name: m.name || m.email || "Unknown",
      runDays: 0,          // days with a qualifying run
      shortRuns: 0,        // runs below the minimum
      badmintonDays: 0,
      sessions: 0,         // distinct days present for anything qualifying
      totalKm: 0,
      totalSec: 0,         // only from runs where a time was entered
      timedRuns: 0,
      timedKm: 0,          // distance from timed runs only, for a fair average pace
      longestKm: 0,
      bestPaceSec: null,   // seconds per km
      presentDates: new Set(),
    });
  }

  for (const log of logs) {
    const s = stats.get(log.uid);
    if (!s) continue; // a log whose member doc is missing

    if (log.activity === "run") {
      const km = Number(log.distanceKm) || 0;
      const sec = Number(log.durationSec) || 0;
      s.totalKm += km;
      if (km > s.longestKm) s.longestKm = km;

      if (sec > 0 && km > 0) {
        s.totalSec += sec;
        s.timedRuns += 1;
        s.timedKm += km;
        const pace = sec / km;
        if (s.bestPaceSec === null || pace < s.bestPaceSec) s.bestPaceSec = pace;
      }

      if (km >= RULES.minRunKm) {
        s.runDays += 1;
        s.presentDates.add(log.date);
      } else {
        s.shortRuns += 1;
      }
    } else if (log.activity === "badminton") {
      s.badmintonDays += 1;
      s.presentDates.add(log.date);
    }
  }

  for (const s of stats.values()) {
    s.sessions = s.presentDates.size;
    s.avgPaceSec = s.timedKm > 0 ? s.totalSec / s.timedKm : null;
  }

  return [...stats.values()];
}
