import {
  db, RULES, el, DAY_NAMES, ACTIVITIES, ready, mountAuth,
  parseDateStr, mondayOf, addDays, today, firstWeek, inSeason,
  logId, fmtDuration, fmtPace,
} from "./shared.js";
import {
  doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

let currentUser = null;
let isAdmin = false;
let weekStart = null; // YYYY-MM-DD, always a Monday
let myTodayLogs = {};
let editing = null;

await ready;

/* ---------- duration helpers ---------- */

function readDuration(minId, secId) {
  const min = parseInt(el(minId).value, 10);
  const sec = parseInt(el(secId).value, 10);
  return (Number.isFinite(min) ? min : 0) * 60 + (Number.isFinite(sec) ? sec : 0);
}

function writeDuration(minId, secId, totalSec) {
  if (!totalSec) {
    el(minId).value = "";
    el(secId).value = "";
    return;
  }
  el(minId).value = Math.floor(totalSec / 60);
  el(secId).value = String(totalSec % 60).padStart(2, "0");
}

/* ---------- boot ---------- */

mountAuth(async (user) => {
  currentUser = user;
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
  el("today-label").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long",
  });
  el("today-note").textContent = `Sessions run ${RULES.windowLabel}. Runs count from ${RULES.minRunKm}km.`;
  el("legend-min").textContent = RULES.minRunKm;
  el("run-hint").textContent = `Counts as attendance from ${RULES.minRunKm}km. Time is optional.`;
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
      const parts = [`${entry.distanceKm}km`];
      if (entry.durationSec) {
        parts.push(fmtDuration(entry.durationSec));
        parts.push(`${fmtPace(entry.durationSec, entry.distanceKm)}/km`);
      }
      const short = entry.distanceKm < RULES.minRunKm ? ` (under ${RULES.minRunKm}km)` : "";
      state.textContent = `Logged · ${parts.join(" · ")}${short}`;
    } else {
      state.textContent = "Logged";
    }
  }
  if (myTodayLogs.run) {
    el("run-km").value = myTodayLogs.run.distanceKm;
    writeDuration("run-min", "run-sec", myTodayLogs.run.durationSec);
  }
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

async function writeLog(member, date, activity, distanceKm, durationSec) {
  await setDoc(doc(db, "logs", logId(member.uid, date, activity)), {
    uid: member.uid,
    name: member.name,
    date,
    activity,
    distanceKm,
    durationSec,
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
  let durationSec = 0;
  if (activity === "run") {
    distanceKm = parseFloat(el("run-km").value);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
      el("log-error").textContent = "Enter how far you ran to log it.";
      return;
    }
    durationSec = readDuration("run-min", "run-sec");
  }
  btn.disabled = true;
  try {
    await writeLog(me(), today(), activity, distanceKm, durationSec);
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
    if (activity === "run") {
      el("run-km").value = "";
      writeDuration("run-min", "run-sec", 0);
    }
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
        query(collection(db, "logs"), where("date", ">=", days[0]), where("date", "<=", days[6]))
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
        const bits = [`Run · ${entries.run.distanceKm}km`];
        if (entries.run.durationSec) {
          bits.push(fmtDuration(entries.run.durationSec));
          bits.push(`${fmtPace(entries.run.durationSec, entries.run.distanceKm)}/km`);
        }
        dot.title = bits.join(" · ");
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
    weekday: "long", day: "numeric", month: "long",
  });

  el("edit-run").checked = Boolean(entries.run);
  el("edit-km").value = entries.run ? entries.run.distanceKm : "";
  writeDuration("edit-min", "edit-sec", entries.run?.durationSec || 0);
  el("edit-badminton").checked = Boolean(entries.badminton);
  syncRunFields();
  el("editor").showModal();
}

function syncRunFields() {
  const on = el("edit-run").checked;
  el("edit-km").disabled = !on;
  el("edit-min").disabled = !on;
  el("edit-sec").disabled = !on;
}

el("edit-run").addEventListener("change", syncRunFields);
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
    await Promise.all([
      wantRun
        ? writeLog(member, date, "run", km, readDuration("edit-min", "edit-sec"))
        : deleteDoc(doc(db, "logs", logId(member.uid, date, "run"))).catch(() => {}),
      wantBad
        ? writeLog(member, date, "badminton", 0, 0)
        : deleteDoc(doc(db, "logs", logId(member.uid, date, "badminton"))).catch(() => {}),
    ]);
    el("editor").close();
    await Promise.all([loadMyToday(), loadWeek()]);
  } catch (err) {
    el("editor-error").textContent = `Couldn't save: ${err.message}`;
  } finally {
    saveBtn.disabled = false;
  }
});
