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
let isAdmin = false;
let weekStart = null; // YYYY-MM-DD, always a Monday
let myTodayLogs = {};
let editing = null; // { member, date, logs }

/* ---------- date helpers (viewer's local timezone) ---------- */

function toDateStr(d) {
  // Local calendar date, not UTC — logging at 11pm IST should still say today.
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
const firstWeek = () => mondayOf(RULES.seasonStart);
const inSeason = (date) => date >= RULES.seasonStart && date <= today();

const logId = (uid, date, activity) => `${uid}_${date}_${activity}`;

/* ---------- auth ---------- */

// Persist the session in localStorage so teammates stay signed in across
// reloads, tabs and restarts until they explicitly sign out.
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
    isAdmin = false;
    el("app-view").classList.add("hidden");
    el("signin-view").classList.remove("hidden");
    return;
  }

  el("signin-view").classList.add("hidden");
  el("app-view").classList.remove("hidden");
  el("user-name").textContent = user.displayName || user.email;

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

  // An admin can edit anyone's records; everyone else edits only their own.
  try {
    isAdmin = (await getDoc(doc(db, "admins", user.uid))).exists();
  } catch {
    isAdmin = false;
  }
  el("user-role").textContent = isAdmin ? "Admin — you can edit anyone" : "Logging for yourself";
  el("roster-hint").textContent = isAdmin
    ? "Tap any day to edit that person's record."
    : "Tap any day in your own row to edit it.";

  renderTodayHeader();
  weekStart = mondayOf();
  await Promise.all([loadMyToday(), loadWeek()]);
});

/* ---------- today's quick check-in ---------- */

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

async function fetchLogs(uid, date) {
  const snaps = await Promise.all(
    ACTIVITIES.map((a) => getDoc(doc(db, "logs", logId(uid, date, a))))
  );
  const out = {};
  snaps.forEach((s) => {
    if (s.exists()) out[s.data().activity] = s.data();
  });
  return out;
}

async function loadMyToday() {
  myTodayLogs = await fetchLogs(currentUser.uid, today());
  renderCards();
}

function renderCards() {
  for (const activity of ACTIVITIES) {
    const card = el(`card-${activity}`);
    const entry = myTodayLogs[activity];
    card.classList.toggle("is-logged", Boolean(entry));
    card.querySelector(".btn-log").classList.toggle("hidden", Boolean(entry));
    card.querySelector(".btn-undo").classList.toggle("hidden", !entry);

    const state = el(`${activity}-state`);
    if (!entry) {
      state.textContent = "Not logged";
    } else if (activity === "run") {
      state.textContent =
        entry.distanceKm >= RULES.minRunKm
          ? `Logged · ${entry.distanceKm}km`
          : `Logged · ${entry.distanceKm}km (under ${RULES.minRunKm}km)`;
    } else {
      state.textContent = "Logged";
    }
  }
  if (myTodayLogs.run) el("run-km").value = myTodayLogs.run.distanceKm;
}

// Only the two "today" cards carry data-activity. The edit sheet's Save
// button reuses .btn-log for styling but has its own handler.
document.querySelectorAll(".btn-log").forEach((btn) => {
  if (btn.dataset.activity) {
    btn.addEventListener("click", () => quickLog(btn.dataset.activity, btn));
  }
});
document.querySelectorAll(".btn-undo").forEach((btn) => {
  if (btn.dataset.activity) {
    btn.addEventListener("click", () => quickRemove(btn.dataset.activity, btn));
  }
});

async function writeLog(member, date, activity, distanceKm) {
  await setDoc(doc(db, "logs", logId(member.uid, date, activity)), {
    uid: member.uid,
    name: member.name,
    date,
    activity,
    distanceKm,
    loggedAt: serverTimestamp(),
    editedBy: currentUser.uid,
  });
}

const me = () => ({
  uid: currentUser.uid,
  name: currentUser.displayName || currentUser.email,
});

async function quickLog(activity, btn) {
  el("log-error").textContent = "";
  let distanceKm = 0;
  if (activity === "run") {
    distanceKm = parseFloat(el("run-km").value);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
      el("log-error").textContent = "Enter how far you ran to log it.";
      return;
    }
  }
  btn.disabled = true;
  try {
    await writeLog(me(), today(), activity, distanceKm);
    await Promise.all([loadMyToday(), loadWeek()]);
  } catch (err) {
    el("log-error").textContent = `Couldn't save that: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

async function quickRemove(activity, btn) {
  el("log-error").textContent = "";
  btn.disabled = true;
  try {
    await deleteDoc(doc(db, "logs", logId(currentUser.uid, today(), activity)));
    if (activity === "run") el("run-km").value = "";
    await Promise.all([loadMyToday(), loadWeek()]);
  } catch (err) {
    el("log-error").textContent = `Couldn't remove that: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- weekly roster ---------- */

el("prev-week").addEventListener("click", () => {
  if (weekStart <= firstWeek()) return;
  weekStart = addDays(weekStart, -7);
  loadWeek();
});

el("next-week").addEventListener("click", () => {
  if (weekStart >= mondayOf()) return;
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

const canEdit = (uid) => isAdmin || uid === currentUser.uid;

function renderRoster(members, byUid, days) {
  const fmt = { day: "numeric", month: "short" };
  el("week-label").textContent =
    `${parseDateStr(days[0]).toLocaleDateString(undefined, fmt)} – ` +
    `${parseDateStr(days[6]).toLocaleDateString(undefined, fmt)}`;

  el("prev-week").disabled = weekStart <= firstWeek();
  el("next-week").disabled = weekStart >= mondayOf();

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
      const entries = byUid[member.uid]?.[date] || {};
      const td = document.createElement("td");
      if (!RULES.activeDays.includes(label)) td.classList.add("rest-day");

      const content = document.createElement("span");
      content.className = "marks";
      if (entries.run) {
        const dot = document.createElement("i");
        dot.className = `mark ${entries.run.distanceKm >= RULES.minRunKm ? "mark-run" : "mark-short"}`;
        dot.title = `Run · ${entries.run.distanceKm}km`;
        content.appendChild(dot);
      }
      if (entries.badminton) {
        const dot = document.createElement("i");
        dot.className = "mark mark-bad";
        dot.title = "Badminton";
        content.appendChild(dot);
      }
      if (!content.childElementCount) {
        content.classList.add("mark-none");
        content.textContent = "·";
      }

      // Editable only if it's your row (or you're an admin) and the date is
      // inside the season and not in the future.
      if (canEdit(member.uid) && inSeason(date)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cell-edit";
        btn.appendChild(content);
        btn.title = `Edit ${member.name} · ${date}`;
        btn.addEventListener("click", () => openEditor(member, date, entries));
        td.appendChild(btn);
      } else {
        td.appendChild(content);
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

/* ---------- edit sheet ---------- */

function openEditor(member, date, entries) {
  editing = { member, date };
  el("editor-error").textContent = "";
  el("editor-who").textContent =
    member.uid === currentUser.uid ? "Your record" : member.name || member.email;
  el("editor-when").textContent = parseDateStr(date).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  el("edit-run").checked = Boolean(entries.run);
  el("edit-km").value = entries.run ? entries.run.distanceKm : "";
  el("edit-badminton").checked = Boolean(entries.badminton);
  syncKmField();
  el("editor").showModal();
}

function syncKmField() {
  el("edit-km").disabled = !el("edit-run").checked;
}

el("edit-run").addEventListener("change", syncKmField);
el("editor-cancel").addEventListener("click", () => el("editor").close());

el("editor-save").addEventListener("click", async () => {
  if (!editing) return;
  const { member, date } = editing;
  const wantRun = el("edit-run").checked;
  const wantBad = el("edit-badminton").checked;
  const km = parseFloat(el("edit-km").value);

  if (wantRun && (!Number.isFinite(km) || km <= 0)) {
    el("editor-error").textContent = "Enter the distance for the run.";
    return;
  }

  const saveBtn = el("editor-save");
  saveBtn.disabled = true;
  el("editor-error").textContent = "";
  try {
    const ops = [];
    ops.push(
      wantRun
        ? writeLog(member, date, "run", km)
        : deleteDoc(doc(db, "logs", logId(member.uid, date, "run"))).catch(() => {})
    );
    ops.push(
      wantBad
        ? writeLog(member, date, "badminton", 0)
        : deleteDoc(doc(db, "logs", logId(member.uid, date, "badminton"))).catch(() => {})
    );
    await Promise.all(ops);
    el("editor").close();
    await Promise.all([loadMyToday(), loadWeek()]);
  } catch (err) {
    el("editor-error").textContent = `Couldn't save: ${err.message}`;
  } finally {
    saveBtn.disabled = false;
  }
});
