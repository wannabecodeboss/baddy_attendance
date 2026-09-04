import {
  db, RULES, el, ready, mountAuth,
  mondayOf, today, toDateStr, parseDateStr,
  fmtDuration, fmtPace, fmtKm,
  loadSeasonData, buildStats, activeDaysElapsed,
} from "./shared.js";
import {
  collection, query, where, getDocs,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firestore = { collection, query, where, getDocs };

let range = "season";

await ready;

mountAuth(async (user) => {
  el("user-name").textContent = user.displayName || user.email;
  await load();
});

document.querySelectorAll(".range-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    range = btn.dataset.range;
    document.querySelectorAll(".range-btn").forEach((b) =>
      b.classList.toggle("is-on", b === btn)
    );
    load();
  });
});

function rangeStart() {
  if (range === "week") return mondayOf();
  if (range === "month") {
    const d = new Date();
    return toDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
  }
  return RULES.seasonStart;
}

async function load() {
  el("board-status").textContent = "Loading…";
  // Never look further back than the season opener, whatever the filter says.
  const from = rangeStart() < RULES.seasonStart ? RULES.seasonStart : rangeStart();
  const to = today();

  try {
    const { members, logs } = await loadSeasonData(db, firestore, from, to);
    const stats = buildStats(members, logs);
    const possible = activeDaysElapsed(from, to);

    const fmt = { day: "numeric", month: "short" };
    el("range-note").textContent =
      `${parseDateStr(from).toLocaleDateString(undefined, fmt)} – ` +
      `${parseDateStr(to).toLocaleDateString(undefined, fmt)} · ` +
      `${possible} session ${possible === 1 ? "day" : "days"} so far`;
    el("attendance-sub").textContent =
      `Days present out of ${possible}. A run counts from ${RULES.minRunKm}km.`;

    renderAttendance(stats, possible);
    renderRunning(stats);
    el("board-status").textContent = "";
  } catch (err) {
    el("board-status").textContent = `Couldn't load the leaderboard: ${err.message}`;
  }
}

/** Ranks with ties sharing a place (1, 2, 2, 4). */
function withRanks(rows, valueOf) {
  let lastValue = null;
  let lastRank = 0;
  return rows.map((row, i) => {
    const v = valueOf(row);
    if (v !== lastValue) {
      lastRank = i + 1;
      lastValue = v;
    }
    return { ...row, rank: lastRank };
  });
}

function buildTable(tableId, columns, rows, emptyMsg) {
  const thead = document.querySelector(`#${tableId} thead`);
  const tbody = document.querySelector(`#${tableId} tbody`);
  thead.replaceChildren();
  tbody.replaceChildren();

  const headRow = document.createElement("tr");
  columns.forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c.label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columns.length;
    td.className = "mark-none";
    td.textContent = emptyMsg;
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    if (row.isYou) tr.classList.add("is-you");
    if (row.rank <= 3) tr.classList.add(`medal-${row.rank}`);
    columns.forEach((c) => {
      const td = document.createElement("td");
      td.textContent = c.get(row);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderAttendance(stats, possible) {
  const rows = stats
    .slice()
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));

  buildTable(
    "attendance-board",
    [
      { label: "#", get: (r) => r.rank },
      { label: "Teammate", get: (r) => r.name },
      { label: "Present", get: (r) => r.sessions },
      { label: "Runs", get: (r) => r.runDays },
      { label: "Badminton", get: (r) => r.badmintonDays },
      {
        label: "Rate",
        get: (r) => (possible > 0 ? `${Math.round((r.sessions / possible) * 100)}%` : "—"),
      },
    ],
    withRanks(rows, (r) => r.sessions),
    "No attendance logged in this range yet."
  );
}

function renderRunning(stats) {
  const rows = stats
    .filter((s) => s.totalKm > 0)
    .sort((a, b) => b.totalKm - a.totalKm || a.name.localeCompare(b.name));

  buildTable(
    "running-board",
    [
      { label: "#", get: (r) => r.rank },
      { label: "Teammate", get: (r) => r.name },
      { label: "Runs", get: (r) => r.runDays + r.shortRuns },
      { label: "Distance", get: (r) => fmtKm(r.totalKm) },
      { label: "Time", get: (r) => fmtDuration(r.totalSec) },
      { label: "Avg pace", get: (r) => (r.avgPaceSec ? `${fmtPace(r.avgPaceSec, 1)}/km` : "—") },
      { label: "Best pace", get: (r) => (r.bestPaceSec ? `${fmtPace(r.bestPaceSec, 1)}/km` : "—") },
      { label: "Longest", get: (r) => fmtKm(r.longestKm) },
    ],
    withRanks(rows, (r) => r.totalKm),
    "No runs logged in this range yet."
  );
}
