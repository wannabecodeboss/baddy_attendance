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
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { firebaseConfig, RULES } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const el = (id) => document.getElementById(id);
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ACTIVITIES = ["run", "badminton"];

let currentUser = null;
let weekStart = null; // YYYY-MM-DD, always a Monday
let myTodayLogs = {}; // { run: {...}, badminton: {...} }

/* ---------- date helpers (all in the viewer's local timezone) ---------- */

function toDateStr(d) {
  // Local calendar date, not UTC — someone logging at 11pm IST should get today.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function mondayOf(dateStr) {
  const d = dateStr ? parseDateStr(dateStr) : new Date();
  const shift = (d.getDay() === 0 ? -6 : 1) - d.getDay();
  d.setDate(d.getDate() + shift);
  return toDateStr(d);
}

function addDays(dateStr, n) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

const today = () => toDateStr(new Date());

/* ---------- auth ---------- */

// Persist the session in localStorage so teammates stay signed in
// across tabs, reloads, and app restarts until they explicitly sign out.
await setPersistence(auth, browserLocalPersistence);

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
  currentUser = user;

  if (!user) {
    el("app-view").classList.add("hidden");
    el("signin-view").classList.remove("hidden");
    return;
  }

  el("signin-view").classList.add("hidden");
  el("app-view").classList.remove("hidden");
  el("user-name").textContent = user.displayName || user.email;

  // Register in the roster so teammates with zero logs still appear.
  await setDoc(
    doc(db, "members", user.uid),
    {
      uid: user.uid,
      name: user.displayName || user.email,
      email: user.email,
      joinedAt: serverTimestamp(),
    },
    { merge: true }
  );

  renderTodayHeader();
  weekStart = mondayOf();
  await Promise.all([loadMyToday(), loadWeek()]);
});

/* ---------- today's check-in ---------- */

function renderTodayHeader() {
  const d = new Date();
  el("today-label").textContent = d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  el("today-note").textContent = `Sessions run ${RULES.windowLabel}. Runs count from ${RULES.minRunKm}km.`;
  el("legend-min").textContent = RULES.minRunKm;
  el("run-hint").textContent = `Counts as attendance from ${RULES.minRunKm}km.`;
}

function logId(uid, date, activity) {
  return `${uid}_${date}_${activity}`;
}

async function loadMyToday() {
  myTodayLogs = {};
  const date = today();
  // Doc ids are deterministic, so read them directly instead of querying.
  const snaps = await Promise.all(
    ACTIVITIES.map((a) => getDoc(doc(db, "logs", logId(currentUser.uid, date, a))))
  );
  snaps.forEach((snap) => {
    if (snap.exists()) myTodayLogs[snap.data().activity] = snap.data();
  });
  renderCards();
}

function renderCards() {
  for (const activity of ACTIVITIES) {
    const card = el(`card-${activity}`);
    const entry = myTodayLogs[activity];
    const logBtn = card.querySelector(".btn-log");
    const undoBtn = card.querySelector(".btn-undo");

    card.classList.toggle("is-logged", Boolean(entry));
    logBtn.classList.toggle("hidden", Boolean(entry));
    undoBtn.classList.toggle("hidden", !entry);

    const state = el(`${activity}-state`);
    if (!entry) {
      state.textContent = "Not logged";
    } else if (activity === "run") {
      const counts = entry.distanceKm >= RULES.minRunKm;
      state.textContent = counts
        ? `Logged · ${entry.distanceKm}km`
        : `Logged · ${entry.distanceKm}km (under ${RULES.minRunKm}km)`;
    } else {
      state.textContent = "Logged";
    }
  }

  const runEntry = myTodayLogs.run;
  if (runEntry) el("run-km").value = runEntry.distanceKm;
}

document.querySelectorAll(".btn-log").forEach((btn) => {
  btn.addEventListener("click", () => saveLog(btn.dataset.activity, btn));
});

document.querySelectorAll(".btn-undo").forEach((btn) => {
  btn.addEventListener("click", () => removeLog(btn.dataset.activity, btn));
});

async function saveLog(activity, btn) {
  el("log-error").textContent = "";

  let distanceKm = 0;
  if (activity === "run") {
    distanceKm = parseFloat(el("run-km").value);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
      el("log-error").textContent = "Enter how far you ran to log it.";
      return;
    }
  }

  const date = today();
  btn.disabled = true;
  try {
    const entry = {
      uid: currentUser.uid,
      name: currentUser.displayName || currentUser.email,
      date,
      activity,
      distanceKm,
      loggedAt: serverTimestamp(),
    };
    await setDoc(doc(db, "logs", logId(currentUser.uid, date, activity)), entry);
    myTodayLogs[activity] = { ...entry, loggedAt: new Date() };
    renderCards();
    await loadWeek();
  } catch (err) {
    el("log-error").textContent = `Couldn't save that: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

async function removeLog(activity, btn) {
  el("log-error").textContent = "";
  btn.disabled = true;
  try {
    await deleteDoc(doc(db, "logs", logId(currentUser.uid, today(), activity)));
    delete myTodayLogs[activity];
    if (activity === "run") el("run-km").value = "";
    renderCards();
    await loadWeek();
  } catch (err) {
    el("log-error").textContent = `Couldn't remove that: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- weekly roster ---------- */

el("prev-week").addEventListener("click", () => {
  weekStart = addDays(weekStart, -7);
  loadWeek();
});

el("next-week").addEventListener("click", () => {
  weekStart = addDays(weekStart, 7);
  loadWeek();
});

async function loadWeek() {
  el("roster-status").textContent = "Loading the week…";
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  try {
    const [memberSnap, logSnap] = await Promise.all([
      getDocs(collection(db, "members")),
      getDocs(
        query(
          collection(db, "logs"),
          where("date", ">=", days[0]),
          where("date", "<=", days[6])
        )
      ),
    ]);

    const members = memberSnap.docs.map((d) => d.data());
    // byUid[uid][date] = { run: entry, badminton: entry }
    const byUid = {};
    logSnap.forEach((d) => {
      const log = d.data();
      byUid[log.uid] ??= {};
      byUid[log.uid][log.date] ??= {};
      byUid[log.uid][log.date][log.activity] = log;
    });

    renderRoster(members, byUid, days);
    el("roster-status").textContent = "";
  } catch (err) {
    el("roster-status").textContent = `Couldn't load the week: ${err.message}`;
  }
}

function renderRoster(members, byUid, days) {
  const start = parseDateStr(days[0]);
  const end = parseDateStr(days[6]);
  const fmt = { day: "numeric", month: "short" };
  el("week-label").textContent = `${start.toLocaleDateString(undefined, fmt)} – ${end.toLocaleDateString(undefined, fmt)}`;

  const thead = document.querySelector("#roster-table thead");
  const tbody = document.querySelector("#roster-table tbody");
  thead.replaceChildren();
  tbody.replaceChildren();

  const headRow = document.createElement("tr");
  const nameHead = document.createElement("th");
  nameHead.textContent = "Teammate";
  headRow.appendChild(nameHead);

  days.forEach((date) => {
    const label = DAY_NAMES[parseDateStr(date).getDay()];
    const th = document.createElement("th");
    if (!RULES.activeDays.includes(label)) th.classList.add("rest-day");
    const small = document.createElement("small");
    small.textContent = date.slice(8);
    th.append(label, small);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  if (members.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.className = "mark-none";
    td.textContent = "No one has signed in yet. Share the link with your team.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  // Your own row first, then everyone else alphabetically.
  members.sort((a, b) => {
    if (a.uid === currentUser.uid) return -1;
    if (b.uid === currentUser.uid) return 1;
    return (a.name || "").localeCompare(b.name || "");
  });

  members.forEach((member) => {
    const tr = document.createElement("tr");
    if (member.uid === currentUser.uid) tr.classList.add("is-you");

    const nameTd = document.createElement("td");
    nameTd.textContent = member.name || member.email;
    tr.appendChild(nameTd);

    days.forEach((date) => {
      const label = DAY_NAMES[parseDateStr(date).getDay()];
      const td = document.createElement("td");
      if (!RULES.activeDays.includes(label)) td.classList.add("rest-day");

      const entries = byUid[member.uid]?.[date] || {};
      const marks = document.createElement("span");
      marks.className = "marks";

      if (entries.run) {
        const counts = entries.run.distanceKm >= RULES.minRunKm;
        const dot = document.createElement("i");
        dot.className = `mark ${counts ? "mark-run" : "mark-short"}`;
        dot.title = `Run · ${entries.run.distanceKm}km`;
        marks.appendChild(dot);
      }
      if (entries.badminton) {
        const dot = document.createElement("i");
        dot.className = "mark mark-bad";
        dot.title = "Badminton";
        marks.appendChild(dot);
      }

      if (!marks.childElementCount) {
        td.className += " mark-none";
        td.textContent = "·";
      } else {
        td.appendChild(marks);
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}
