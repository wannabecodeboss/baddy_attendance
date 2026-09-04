import {
  db, RULES, el, ready, mountAuth, today,
  loadLadders, matchesFor,
} from "./shared.js";
import { LADDERS } from "./firebase-config.js";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection,
  writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firestore = { collection, getDocs };

let currentUser = null;
let isAdmin = false;
let myGender = null;
let data = { members: [], ranks: [], matches: [] };
const open = new Set(); // uids whose history row is expanded

await ready;

mountAuth(async (user) => {
  currentUser = user;
  el("user-name").textContent = user.displayName || user.email;

  try {
    isAdmin = (await getDoc(doc(db, "admins", user.uid))).exists();
  } catch {
    isAdmin = false;
  }

  myGender = await ensureGender();
  await load();
});

/* ---------- onboarding: which ladder ---------- */

async function ensureGender() {
  let g = null;
  try {
    const snap = await getDoc(doc(db, "members", currentUser.uid));
    if (snap.exists()) g = snap.data().gender || null;
  } catch { /* fall through to the picker */ }
  if (g === "M" || g === "F") return g;
  return pickGender();
}

function pickGender() {
  return new Promise((resolve) => {
    const dlg = el("gender-dialog");
    el("gender-error").textContent = "";
    dlg.querySelectorAll("[data-gender]").forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await setDoc(
            doc(db, "members", currentUser.uid),
            {
              uid: currentUser.uid,
              name: currentUser.displayName || currentUser.email,
              email: currentUser.email,
              gender: btn.dataset.gender,
            },
            { merge: true }
          );
          dlg.close();
          resolve(btn.dataset.gender);
        } catch (err) {
          el("gender-error").textContent = `Couldn't save that: ${err.message}`;
          btn.disabled = false;
        }
      };
    });
    dlg.showModal();
  });
}

/* ---------- load + render ---------- */

async function load() {
  el("ladder-status").textContent = "Loading…";
  try {
    data = await loadLadders(db, firestore);
  } catch (err) {
    el("ladder-status").textContent = `Couldn't load the ladder: ${err.message}`;
    return;
  }
  el("ladder-status").textContent = "";

  el("admin-panel").classList.toggle("hidden", !isAdmin);
  if (isAdmin) renderAdminActions();

  // Before launch the ladder still renders (so an admin can see who needs
  // seeding) — just with a note that it isn't live yet.
  el("ladder-disabled").classList.toggle("hidden", RULES.ladderEnabled);
  el("ladder-body").classList.remove("hidden");
  renderLadders();
  renderUnranked();
}

const rankByUid = (uid) => data.ranks.find((r) => r.uid === uid) || null;
const memberName = (uid) => {
  const m = data.members.find((x) => x.uid === uid);
  const r = rankByUid(uid);
  return (r && r.name) || (m && (m.name || m.email)) || "Unknown";
};
const myRank = () => {
  const r = rankByUid(currentUser.uid);
  return r && r.gender === myGender ? r.rank : null;
};

function renderLadders() {
  const host = el("ladders");
  host.replaceChildren();

  for (const ladder of LADDERS) {
    const rows = data.ranks
      .filter((r) => r.gender === ladder.key)
      .sort((a, b) => a.rank - b.rank);

    const block = document.createElement("div");
    block.className = "ladder-block";

    const h = document.createElement("h3");
    h.className = "board-title";
    h.textContent = `${ladder.label}’s ladder`;
    block.appendChild(h);

    if (rows.length === 0) {
      const p = document.createElement("p");
      p.className = "board-sub";
      p.textContent = "No one seeded yet.";
      block.appendChild(p);
      host.appendChild(block);
      continue;
    }

    const scroll = document.createElement("div");
    scroll.className = "table-scroll";
    const table = document.createElement("table");
    table.className = "ladder-table";
    const thead = document.createElement("thead");
    thead.innerHTML =
      "<tr><th>#</th><th>Player</th><th>P</th><th>W</th><th>L</th><th></th></tr>";
    const tbody = document.createElement("tbody");

    const mine = myGender === ladder.key ? myRank() : null;

    rows.forEach((r) => {
      tbody.appendChild(playerRow(r, ladder, mine));
      if (open.has(r.uid)) tbody.appendChild(historyRow(r, ladder));
    });

    table.append(thead, tbody);
    scroll.appendChild(table);
    block.appendChild(scroll);
    host.appendChild(block);
  }
}

function playerRow(r, ladder, myRankNum) {
  const tr = document.createElement("tr");
  if (r.uid === currentUser.uid) tr.classList.add("is-you");

  const tdRank = document.createElement("td");
  tdRank.textContent = r.rank;
  tdRank.className = "col-rank";
  tr.appendChild(tdRank);

  const tdName = document.createElement("td");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ladder-name-btn";
  toggle.textContent = (open.has(r.uid) ? "▾ " : "▸ ") + memberName(r.uid);
  toggle.setAttribute("aria-expanded", open.has(r.uid) ? "true" : "false");
  toggle.addEventListener("click", () => {
    if (open.has(r.uid)) open.delete(r.uid);
    else open.add(r.uid);
    renderLadders();
  });
  tdName.appendChild(toggle);
  tr.appendChild(tdName);

  for (const key of ["played", "wins", "losses"]) {
    const td = document.createElement("td");
    td.textContent = r[key] ?? 0;
    tr.appendChild(td);
  }

  const tdAct = document.createElement("td");
  tdAct.className = "col-act";
  const challengeable =
    myRankNum != null &&
    r.uid !== currentUser.uid &&
    Math.abs(r.rank - myRankNum) <= RULES.challengeGap;
  if (challengeable) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-mini";
    b.textContent = "Record match";
    b.addEventListener("click", () => openRecord(r));
    tdAct.appendChild(b);
  }
  if (isAdmin) {
    const e = document.createElement("button");
    e.type = "button";
    e.className = "btn-mini btn-mini-quiet";
    e.textContent = "Edit";
    e.addEventListener("click", () => openRankEditor(r, ladder));
    tdAct.appendChild(e);
  }
  tr.appendChild(tdAct);
  return tr;
}

function historyRow(r, ladder) {
  const tr = document.createElement("tr");
  tr.className = "history-row";
  const td = document.createElement("td");
  td.colSpan = 6;

  const list = document.createElement("ul");
  list.className = "history-list";
  const hist = matchesFor(r.uid, data.matches);

  if (hist.length === 0) {
    const li = document.createElement("li");
    li.className = "mark-none";
    li.textContent = "No matches yet.";
    list.appendChild(li);
  } else {
    hist.forEach((m) => {
      const oppUid = m.aUid === r.uid ? m.bUid : m.aUid;
      const won = m.winnerUid === r.uid;
      const li = document.createElement("li");

      const date = document.createElement("span");
      date.className = "hist-date";
      date.textContent = m.playedOn || "—";

      const res = document.createElement("span");
      res.className = won ? "hist-win" : "hist-loss";
      res.textContent = won ? "W" : "L";

      const vs = document.createElement("span");
      vs.textContent = ` vs ${memberName(oppUid)} · `;

      const score = document.createElement("span");
      score.className = "hist-score";
      score.textContent = m.score || ""; // text only — user-entered, public

      li.append(date, document.createTextNode(" "), res, vs, score);

      if (isAdmin) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn-mini btn-mini-quiet";
        del.textContent = "Delete";
        del.addEventListener("click", () => adminDeleteMatch(m));
        li.append(document.createTextNode(" "), del);
      }
      list.appendChild(li);
    });
  }
  td.appendChild(list);
  tr.appendChild(td);
  return tr;
}

function renderUnranked() {
  const ul = el("unranked-list");
  ul.replaceChildren();
  const rankedUids = new Set(data.ranks.map((r) => r.uid));
  const unranked = data.members.filter(
    (m) => m.gender && !rankedUids.has(m.uid)
  );

  if (unranked.length === 0) {
    const li = document.createElement("li");
    li.className = "mark-none";
    li.textContent = "Everyone with a ladder pick is seeded.";
    ul.appendChild(li);
    return;
  }
  unranked.forEach((m) => {
    const li = document.createElement("li");
    const label = LADDERS.find((l) => l.key === m.gender);
    li.textContent = `${m.name || m.email} — ${label ? label.label : m.gender}`;
    if (m.uid === currentUser.uid) li.classList.add("is-you-plain");
    ul.appendChild(li);
  });
}

/* ---------- record a match ---------- */

let recording = null;

function openRecord(opp) {
  const me = rankByUid(currentUser.uid);
  if (!me) return;
  recording = { opp, me };

  el("record-vs").textContent =
    `You (#${me.rank}) vs ${memberName(opp.uid)} (#${opp.rank})`;
  const sel = el("record-winner");
  sel.replaceChildren();
  [
    { v: currentUser.uid, t: `${memberName(currentUser.uid)} (you)` },
    { v: opp.uid, t: memberName(opp.uid) },
  ].forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o.v;
    opt.textContent = o.t;
    sel.appendChild(opt);
  });
  el("record-date").value = today();
  el("record-date").max = today();
  el("record-score").value = "";
  el("record-error").textContent = "";
  updateRecordNote();
  el("record-dialog").showModal();
}

function updateRecordNote() {
  if (!recording) return;
  const { opp, me } = recording;
  const winner = el("record-winner").value;
  const lowerRankNum = Math.max(me.rank, opp.rank); // bigger number = lower place
  const winnerRankNum = winner === currentUser.uid ? me.rank : opp.rank;
  const swap = winnerRankNum === lowerRankNum && me.rank !== opp.rank;
  el("record-note").textContent = swap
    ? `${memberName(winner)} moves to #${Math.min(me.rank, opp.rank)}.`
    : "No rank change — the higher-ranked player wins.";
}

el("record-winner").addEventListener("change", updateRecordNote);
el("record-cancel").addEventListener("click", () => el("record-dialog").close());

el("record-save").addEventListener("click", async () => {
  if (!recording) return;
  const { opp, me } = recording;
  const winnerUid = el("record-winner").value;
  const playedOn = el("record-date").value;
  const score = el("record-score").value.trim();

  if (!playedOn) return fail("Pick the date it was played.");
  if (playedOn > today()) return fail("That date is in the future.");
  if (!score) return fail("Enter the score.");
  if (score.length > RULES.maxScoreLen)
    return fail(`Keep the score under ${RULES.maxScoreLen} characters.`);
  if (playedOn < RULES.seasonStart) return fail("That's before the season started.");

  const iWon = winnerUid === currentUser.uid;
  const higher = Math.min(me.rank, opp.rank);
  const lower = Math.max(me.rank, opp.rank);
  const winnerRankNum = iWon ? me.rank : opp.rank;
  const rankSwapped = winnerRankNum === lower && me.rank !== opp.rank;

  const btn = el("record-save");
  btn.disabled = true;
  el("record-error").textContent = "";
  try {
    const batch = writeBatch(db);
    const matchRef = doc(collection(db, "matches"));
    batch.set(matchRef, {
      gender: myGender,
      participants: [currentUser.uid, opp.uid],
      aUid: currentUser.uid,
      aName: memberName(currentUser.uid),
      bUid: opp.uid,
      bName: memberName(opp.uid),
      winnerUid,
      score,
      playedOn,
      rankSwapped,
      recordedBy: currentUser.uid,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
    });

    batch.update(doc(db, "ranks", currentUser.uid), {
      rank: rankSwapped ? opp.rank : me.rank,
      played: (me.played || 0) + 1,
      wins: (me.wins || 0) + (iWon ? 1 : 0),
      losses: (me.losses || 0) + (iWon ? 0 : 1),
      name: memberName(currentUser.uid),
      lastMatchId: matchRef.id,
      lastMatchWith: opp.uid,
      updatedBy: currentUser.uid,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "ranks", opp.uid), {
      rank: rankSwapped ? me.rank : opp.rank,
      played: (opp.played || 0) + 1,
      wins: (opp.wins || 0) + (iWon ? 0 : 1),
      losses: (opp.losses || 0) + (iWon ? 1 : 0),
      name: memberName(opp.uid),
      lastMatchId: matchRef.id,
      lastMatchWith: currentUser.uid,
      updatedBy: currentUser.uid,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    el("record-dialog").close();
    recording = null;
    await load();
  } catch (err) {
    el("record-error").textContent = `Couldn't save: ${err.message}`;
  } finally {
    btn.disabled = false;
  }

  function fail(msg) {
    el("record-error").textContent = msg;
  }
});

/* ---------- admin: seed / normalize / reshuffle ---------- */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderAdminActions() {
  const host = el("admin-actions");
  host.replaceChildren();
  LADDERS.forEach((ladder) => {
    const wrap = document.createElement("div");
    wrap.className = "admin-ladder";
    const label = document.createElement("span");
    label.className = "admin-ladder-label";
    label.textContent = ladder.label;
    wrap.appendChild(label);

    wrap.appendChild(adminBtn("Seed unranked", () => seedUnranked(ladder.key)));
    wrap.appendChild(adminBtn("Normalize", () => normalize(ladder.key)));
    wrap.appendChild(
      adminBtn("Reshuffle all", () => reshuffleAll(ladder.key), true)
    );
    host.appendChild(wrap);
  });
}

function adminBtn(text, fn, danger) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn-mini" + (danger ? " btn-mini-danger" : " btn-mini-quiet");
  b.textContent = text;
  b.addEventListener("click", async () => {
    b.disabled = true;
    el("admin-status").textContent = "Working…";
    try {
      await fn();
      await load();
      el("admin-status").textContent = "Done.";
    } catch (err) {
      el("admin-status").textContent = `Failed: ${err.message}`;
    } finally {
      b.disabled = false;
    }
  });
  return b;
}

async function seedUnranked(gender) {
  const rankedUids = new Set(
    data.ranks.filter((r) => r.gender === gender).map((r) => r.uid)
  );
  const maxRank = data.ranks
    .filter((r) => r.gender === gender)
    .reduce((m, r) => Math.max(m, r.rank), 0);
  const toAdd = shuffle(
    data.members.filter((m) => m.gender === gender && !rankedUids.has(m.uid))
  );
  if (toAdd.length === 0) throw new Error("nobody to seed");

  const batch = writeBatch(db);
  toAdd.forEach((m, i) => {
    batch.set(doc(db, "ranks", m.uid), {
      uid: m.uid,
      gender,
      name: m.name || m.email,
      rank: maxRank + i + 1,
      played: 0,
      wins: 0,
      losses: 0,
      updatedBy: currentUser.uid,
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

async function normalize(gender) {
  const rows = data.ranks
    .filter((r) => r.gender === gender)
    .sort((a, b) => a.rank - b.rank);
  const batch = writeBatch(db);
  let changed = 0;
  rows.forEach((r, i) => {
    if (r.rank !== i + 1) {
      batch.update(doc(db, "ranks", r.uid), {
        rank: i + 1,
        updatedBy: currentUser.uid,
        updatedAt: serverTimestamp(),
      });
      changed++;
    }
  });
  if (changed === 0) throw new Error("already 1…N");
  await batch.commit();
}

async function reshuffleAll(gender) {
  const rows = shuffle(data.ranks.filter((r) => r.gender === gender));
  if (rows.length === 0) throw new Error("nobody on this ladder");
  if (!confirm(`Reshuffle every ${gender === "M" ? "men's" : "women's"} rank? This can't be undone.`))
    throw new Error("cancelled");
  const batch = writeBatch(db);
  rows.forEach((r, i) => {
    batch.update(doc(db, "ranks", r.uid), {
      rank: i + 1,
      updatedBy: currentUser.uid,
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

/* ---------- admin: edit one standing ---------- */

let editingRank = null;

function openRankEditor(r, ladder) {
  editingRank = r;
  el("rank-who").textContent = memberName(r.uid);
  el("rank-ladder").textContent = `${ladder.label}’s ladder`;
  el("rank-rank").value = r.rank;
  el("rank-played").value = r.played || 0;
  el("rank-wins").value = r.wins || 0;
  el("rank-losses").value = r.losses || 0;
  el("rank-error").textContent = "";
  el("rank-dialog").showModal();
}

el("rank-save").addEventListener("click", async () => {
  if (!editingRank) return;
  const rank = parseInt(el("rank-rank").value, 10);
  const played = parseInt(el("rank-played").value, 10);
  const wins = parseInt(el("rank-wins").value, 10);
  const losses = parseInt(el("rank-losses").value, 10);
  if (![rank, played, wins, losses].every(Number.isFinite) || rank < 1 ||
      played < 0 || wins < 0 || losses < 0 || wins + losses > played) {
    el("rank-error").textContent = "Check the numbers — wins + losses can't exceed played.";
    return;
  }
  const btn = el("rank-save");
  btn.disabled = true;
  try {
    await updateDoc(doc(db, "ranks", editingRank.uid), {
      rank, played, wins, losses,
      updatedBy: currentUser.uid,
      updatedAt: serverTimestamp(),
    });
    el("rank-dialog").close();
    editingRank = null;
    await load();
  } catch (err) {
    el("rank-error").textContent = `Couldn't save: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

el("rank-remove").addEventListener("click", async () => {
  if (!editingRank) return;
  if (!confirm(`Remove ${memberName(editingRank.uid)} from the ladder?`)) return;
  const btn = el("rank-remove");
  btn.disabled = true;
  try {
    await deleteDoc(doc(db, "ranks", editingRank.uid));
    el("rank-dialog").close();
    editingRank = null;
    await load();
  } catch (err) {
    el("rank-error").textContent = `Couldn't remove: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

async function adminDeleteMatch(m) {
  if (!confirm("Delete this match from the history? Player records won't recalculate.")) return;
  try {
    await deleteDoc(doc(db, "matches", m.id));
    await load();
  } catch (err) {
    el("ladder-status").textContent = `Couldn't delete: ${err.message}`;
  }
}
