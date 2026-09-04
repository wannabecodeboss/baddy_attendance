import {
  db, RULES, el, ready, mountAuth,
  today, parseDateStr,
  fmtDuration, fmtPace, fmtKm,
  loadSeasonData, buildStats, activeDaysElapsed,
} from "./shared.js";
import {
  collection, query, where, getDocs,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firestore = { collection, query, where, getDocs };

let myUid = null;

await ready;

mountAuth(async (user) => {
  myUid = user.uid;
  el("user-name").textContent = user.displayName || user.email;
  await load();
});

async function load() {
  el("totals-status").textContent = "Loading…";
  const from = RULES.seasonStart;
  const to = today();

  try {
    const { members, logs } = await loadSeasonData(db, firestore, from, to);
    const stats = buildStats(members, logs).sort(
      (a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name)
    );
    const possible = activeDaysElapsed(from, to);

    const fmt = { day: "numeric", month: "short" };
    el("totals-sub").textContent =
      `Since ${parseDateStr(from).toLocaleDateString(undefined, fmt)} · ` +
      `${possible} session ${possible === 1 ? "day" : "days"} so far · ` +
      `a run counts from ${RULES.minRunKm}km`;

    renderTotals(stats, possible);
    renderSummary(stats, possible);
    el("totals-status").textContent = "";
  } catch (err) {
    el("totals-status").textContent = `Couldn't load totals: ${err.message}`;
  }
}

function renderTotals(stats, possible) {
  const columns = [
    { label: "Teammate", get: (r) => r.name },
    { label: "Present", get: (r) => `${r.sessions}/${possible}` },
    { label: "Run days", get: (r) => r.runDays },
    { label: "Badminton", get: (r) => r.badmintonDays },
    { label: "Distance", get: (r) => fmtKm(r.totalKm) },
    { label: "Time", get: (r) => fmtDuration(r.totalSec) },
    { label: "Avg pace", get: (r) => (r.avgPaceSec ? `${fmtPace(r.avgPaceSec, 1)}/km` : "—") },
  ];

  const thead = document.querySelector("#totals-table thead");
  const tbody = document.querySelector("#totals-table tbody");
  thead.replaceChildren();
  tbody.replaceChildren();

  const headRow = document.createElement("tr");
  columns.forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c.label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  if (stats.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columns.length;
    td.className = "mark-none";
    td.textContent = "Nobody has signed in yet.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  stats.forEach((row) => {
    const tr = document.createElement("tr");
    if (row.uid === myUid) tr.classList.add("is-you");
    columns.forEach((c) => {
      const td = document.createElement("td");
      td.textContent = c.get(row);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderSummary(stats, possible) {
  const totalSessions = stats.reduce((n, s) => n + s.sessions, 0);
  const totalKm = stats.reduce((n, s) => n + s.totalKm, 0);
  const totalSec = stats.reduce((n, s) => n + s.totalSec, 0);
  const runDays = stats.reduce((n, s) => n + s.runDays, 0);
  const badDays = stats.reduce((n, s) => n + s.badmintonDays, 0);
  const people = stats.filter((s) => s.sessions > 0).length;
  const avgTurnout = possible > 0 ? (totalSessions / possible).toFixed(1) : "0";

  const items = [
    ["People logging", people],
    ["Avg turnout / session", avgTurnout],
    ["Run days", runDays],
    ["Badminton days", badDays],
    ["Distance covered", fmtKm(totalKm)],
    ["Time on feet", fmtDuration(totalSec)],
  ];

  const grid = el("team-summary");
  grid.replaceChildren();
  items.forEach(([label, value]) => {
    const cell = document.createElement("div");
    cell.className = "summary-cell";
    const v = document.createElement("span");
    v.className = "summary-value";
    v.textContent = value;
    const l = document.createElement("span");
    l.className = "summary-label";
    l.textContent = label;
    cell.append(v, l);
    grid.appendChild(cell);
  });
}
