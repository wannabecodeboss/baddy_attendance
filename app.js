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


/* =========================================================
   FIREBASE SETUP
   ========================================================= */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


/* =========================================================
   CONSTANTS / STATE
   ========================================================= */

const el = (id) => document.getElementById(id);

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ACTIVITIES = ["run", "badminton"];

let currentUser = null;
let isAdmin = false;

let weekStart = null;

let myTodayLogs = {};

let editing = null;


/* =========================================================
   DATE HELPERS
   ========================================================= */

/*
 * IMPORTANT:
 * All dates are handled as local calendar dates.
 * This avoids UTC shifting problems for users in India.
 */

function toDateStr(d) {
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
  const d = dateStr
    ? parseDateStr(dateStr)
    : new Date();

  const shift =
    (d.getDay() === 0 ? -6 : 1) - d.getDay();

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


/*
 * A date is editable if:
 *
 *   seasonStart <= date <= today
 *
 * There is NO 36-hour restriction here.
 *
 * This means users can edit old records from previous days.
 */

const inSeason = (date) => {
  return (
    date >= RULES.seasonStart &&
    date <= today()
  );
};


const logId = (uid, date, activity) => {
  return `${uid}_${date}_${activity}`;
};


/* =========================================================
   AUTHENTICATION
   ========================================================= */

await setPersistence(
  auth,
  browserLocalPersistence
);


el("signin-btn").addEventListener(
  "click",
  async () => {
    el("signin-error").textContent = "";

    try {
      await signInWithPopup(
        auth,
        new GoogleAuthProvider()
      );
    } catch (err) {
      el("signin-error").textContent =
        err.code === "auth/popup-blocked"
          ? "Your browser blocked the sign-in popup. Allow popups for this site and try again."
          : `Sign-in failed: ${err.message}`;
    }
  }
);


el("signout-btn").addEventListener(
  "click",
  () => signOut(auth)
);


onAuthStateChanged(
  auth,
  async (user) => {

    el("boot").classList.add("hidden");

    currentUser = user;


    /* -------------------------
       Signed out
       ------------------------- */

    if (!user) {

      isAdmin = false;

      el("app-view").classList.add("hidden");

      el("signin-view").classList.remove("hidden");

      return;
    }


    /* -------------------------
       Signed in
       ------------------------- */

    el("signin-view").classList.add("hidden");

    el("app-view").classList.remove("hidden");

    el("user-name").textContent =
      user.displayName || user.email;


    /*
     * Create/update the user's member record.
     */

    await setDoc(
      doc(db, "members", user.uid),
      {
        uid: user.uid,
        name: user.displayName || user.email,
        email: user.email,
        joinedAt: serverTimestamp(),
      },
      {
        merge: true,
      }
    );


    /*
     * Check whether this user is an admin.
     *
     * Admin behavior is retained.
     */

    try {

      isAdmin = (
        await getDoc(
          doc(db, "admins", user.uid)
        )
      ).exists();

    } catch {

      isAdmin = false;

    }


    el("user-role").textContent =
      isAdmin
        ? "Admin — you can edit anyone"
        : "Logging for yourself";


    el("roster-hint").textContent =
      isAdmin
        ? "Tap any day to edit that person's record."
        : "Tap any day in your own row to edit it.";


    renderTodayHeader();

    weekStart = mondayOf();

    await Promise.all([
      loadMyToday(),
      loadWeek(),
    ]);
  }
);


/* =========================================================
   TODAY HEADER
   ========================================================= */

function renderTodayHeader() {

  const d = new Date();

  el("today-label").textContent =
    d.toLocaleDateString(
      undefined,
      {
        weekday: "long",
        day: "numeric",
        month: "long",
      }
    );


  el("today-note").textContent =
    `Sessions run ${RULES.windowLabel}. Runs count from ${RULES.minRunKm}km.`;


  el("legend-min").textContent =
    RULES.minRunKm;


  el("run-hint").textContent =
    `Counts as attendance from ${RULES.minRunKm}km.`;
}


/* =========================================================
   FETCH LOGS
   ========================================================= */

async function fetchLogs(uid, date) {

  const snaps = await Promise.all(
    ACTIVITIES.map(
      (activity) =>
        getDoc(
          doc(
            db,
            "logs",
            logId(uid, date, activity)
          )
        )
    )
  );


  const out = {};


  snaps.forEach((snap) => {

    if (snap.exists()) {

      out[snap.data().activity] =
        snap.data();

    }

  });


  return out;
}


/* =========================================================
   LOAD TODAY
   ========================================================= */

async function loadMyToday() {

  myTodayLogs =
    await fetchLogs(
      currentUser.uid,
      today()
    );

  renderCards();
}


/* =========================================================
   RENDER TODAY CARDS
   ========================================================= */

function renderCards() {

  for (const activity of ACTIVITIES) {

    const card =
      el(`card-${activity}`);

    const entry =
      myTodayLogs[activity];


    card.classList.toggle(
      "is-logged",
      Boolean(entry)
    );


    card
      .querySelector(".btn-log")
      .classList.toggle(
        "hidden",
        Boolean(entry)
      );


    card
      .querySelector(".btn-undo")
      .classList.toggle(
        "hidden",
        !entry
      );


    const state =
      el(`${activity}-state`);


    if (!entry) {

      state.textContent =
        "Not logged";

    } else if (activity === "run") {

      state.textContent =
        entry.distanceKm >= RULES.minRunKm
          ? `Logged · ${entry.distanceKm}km`
          : `Logged · ${entry.distanceKm}km (under ${RULES.minRunKm}km)`;

    } else {

      state.textContent =
        "Logged";

    }
  }


  if (myTodayLogs.run) {

    el("run-km").value =
      myTodayLogs.run.distanceKm;

  }
}


/* =========================================================
   TODAY BUTTONS
   ========================================================= */

document
  .querySelectorAll(".btn-log")
  .forEach((btn) => {

    if (btn.dataset.activity) {

      btn.addEventListener(
        "click",
        () =>
          quickLog(
            btn.dataset.activity,
            btn
          )
      );

    }

  });


document
  .querySelectorAll(".btn-undo")
  .forEach((btn) => {

    if (btn.dataset.activity) {

      btn.addEventListener(
        "click",
        () =>
          quickRemove(
            btn.dataset.activity,
            btn
          )
      );

    }

  });


/* =========================================================
   WRITE LOG
   ========================================================= */

async function writeLog(
  member,
  date,
  activity,
  distanceKm
) {

  /*
   * IMPORTANT:
   *
   * This writes to the exact document belonging
   * to the user/date/activity combination.
   *
   * Firestore rules independently verify ownership.
   */

  await setDoc(
    doc(
      db,
      "logs",
      logId(
        member.uid,
        date,
        activity
      )
    ),
    {
      uid: member.uid,
      name: member.name,
      date,
      activity,
      distanceKm,
      loggedAt: serverTimestamp(),
      editedBy: currentUser.uid,
    }
  );
}


/* =========================================================
   CURRENT USER
   ========================================================= */

const me = () => ({
  uid: currentUser.uid,

  name:
    currentUser.displayName ||
    currentUser.email,
});


/* =========================================================
   QUICK LOG
   ========================================================= */

async function quickLog(
  activity,
  btn
) {

  el("log-error").textContent = "";

  let distanceKm = 0;


  if (activity === "run") {

    distanceKm =
      parseFloat(
        el("run-km").value
      );


    if (
      !Number.isFinite(distanceKm) ||
      distanceKm <= 0
    ) {

      el("log-error").textContent =
        "Enter how far you ran to log it.";

      return;
    }
  }


  btn.disabled = true;


  try {

    await writeLog(
      me(),
      today(),
      activity,
      distanceKm
    );


    await Promise.all([
      loadMyToday(),
      loadWeek(),
    ]);

  } catch (err) {

    el("log-error").textContent =
      `Couldn't save that: ${err.message}`;

  } finally {

    btn.disabled = false;

  }
}


/* =========================================================
   QUICK REMOVE
   ========================================================= */

async function quickRemove(
  activity,
  btn
) {

  el("log-error").textContent = "";

  btn.disabled = true;


  try {

    await deleteDoc(
      doc(
        db,
        "logs",
        logId(
          currentUser.uid,
          today(),
          activity
        )
      )
    );


    if (activity === "run") {

      el("run-km").value = "";

    }


    await Promise.all([
      loadMyToday(),
      loadWeek(),
    ]);

  } catch (err) {

    el("log-error").textContent =
      `Couldn't remove that: ${err.message}`;

  } finally {

    btn.disabled = false;

  }
}


/* =========================================================
   WEEKLY ROSTER
   ========================================================= */

el("prev-week").addEventListener(
  "click",
  () => {

    if (weekStart <= firstWeek()) {

      return;
    }


    weekStart =
      addDays(
        weekStart,
        -7
      );


    loadWeek();
  }
);


el("next-week").addEventListener(
  "click",
  () => {

    if (weekStart >= mondayOf()) {

      return;
    }


    weekStart =
      addDays(
        weekStart,
        7
      );


    loadWeek();
  }
);


/* =========================================================
   LOAD WEEK
   ========================================================= */

async function loadWeek() {

  el("roster-status").textContent =
    "Loading the week…";


  const days =
    Array.from(
      { length: 7 },
      (_, i) =>
        addDays(
          weekStart,
          i
        )
    );


  try {

    const [
      memberSnap,
      logSnap
    ] = await Promise.all([

      getDocs(
        collection(
          db,
          "members"
        )
      ),

      getDocs(
        query(
          collection(
            db,
            "logs"
          ),

          where(
            "date",
            ">=",
            days[0]
          ),

          where(
            "date",
            "<=",
            days[6]
          )
        )
      ),
    ]);


    const members =
      memberSnap.docs.map(
        (d) => d.data()
      );


    const byUid = {};


    logSnap.forEach((d) => {

      const log = d.data();


      byUid[log.uid] ??= {};

      byUid[log.uid][log.date] ??= {};

      byUid[log.uid][log.date][
        log.activity
      ] = log;

    });


    renderRoster(
      members,
      byUid,
      days
    );


    el("roster-status").textContent = "";

  } catch (err) {

    el("roster-status").textContent =
      `Couldn't load the week: ${err.message}`;

  }
}


/* =========================================================
   EDIT PERMISSION
   ========================================================= */

/*
 * Frontend permission:
 *
 * - normal user -> only their own row
 * - admin -> anyone
 *
 * Firestore independently enforces this.
 */

const canEdit = (uid) => {

  return (
    isAdmin ||
    uid === currentUser.uid
  );

};


/* =========================================================
   RENDER ROSTER
   ========================================================= */

function renderRoster(
  members,
  byUid,
  days
) {

  const fmt = {
    day: "numeric",
    month: "short",
  };


  el("week-label").textContent =
    `${parseDateStr(days[0]).toLocaleDateString(undefined, fmt)} – ` +
    `${parseDateStr(days[6]).toLocaleDateString(undefined, fmt)}`;


  el("prev-week").disabled =
    weekStart <= firstWeek();


  el("next-week").disabled =
    weekStart >= mondayOf();


  const thead =
    document.querySelector(
      "#roster-table thead"
    );


  const tbody =
    document.querySelector(
      "#roster-table tbody"
    );


  thead.replaceChildren();

  tbody.replaceChildren();


  /* -------------------------
     Header
     ------------------------- */

  const headRow =
    document.createElement("tr");


  const nameHead =
    document.createElement("th");


  nameHead.textContent =
    "Teammate";


  headRow.appendChild(
    nameHead
  );


  days.forEach((date) => {

    const label =
      DAY_NAMES[
        parseDateStr(date).getDay()
      ];


    const th =
      document.createElement("th");


    if (
      !RULES.activeDays.includes(label)
    ) {

      th.classList.add(
        "rest-day"
      );

    }


    const small =
      document.createElement("small");


    small.textContent =
      date.slice(8);


    th.append(
      label,
      small
    );


    headRow.appendChild(th);

  });


  thead.appendChild(
    headRow
  );


  /* -------------------------
     Empty roster
     ------------------------- */

  if (members.length === 0) {

    const tr =
      document.createElement("tr");


    const td =
      document.createElement("td");


    td.colSpan = 8;

    td.className =
      "mark-none";


    td.textContent =
      "No one has signed in yet. Share the link with your team.";


    tr.appendChild(td);

    tbody.appendChild(tr);

    return;
  }


  /* -------------------------
     Sort members
     ------------------------- */

  members.sort(
    (a, b) => {

      if (
        a.uid === currentUser.uid
      ) {

        return -1;
      }


      if (
        b.uid === currentUser.uid
      ) {

        return 1;
      }


      return (
        (a.name || "")
          .localeCompare(
            b.name || ""
          )
      );

    }
  );


  /* -------------------------
     Rows
     ------------------------- */

  members.forEach(
    (member) => {

      const tr =
        document.createElement("tr");


      if (
        member.uid ===
        currentUser.uid
      ) {

        tr.classList.add(
          "is-you"
        );

      }


      const nameTd =
        document.createElement("td");


      nameTd.textContent =
        member.name ||
        member.email;


      tr.appendChild(
        nameTd
      );


      days.forEach(
        (date) => {

          const label =
            DAY_NAMES[
              parseDateStr(date)
                .getDay()
            ];


          const entries =
            byUid[member.uid]?.[
              date
            ] || {};


          const td =
            document.createElement("td");


          if (
            !RULES.activeDays.includes(
              label
            )
          ) {

            td.classList.add(
              "rest-day"
            );

          }


          const content =
            document.createElement(
              "span"
            );


          content.className =
            "marks";


          /* -------------------------
             Run
             ------------------------- */

          if (entries.run) {

            const dot =
              document.createElement("i");


            dot.className =
              `mark ${
                entries.run.distanceKm >=
                RULES.minRunKm
                  ? "mark-run"
                  : "mark-short"
              }`;


            dot.title =
              `Run · ${entries.run.distanceKm}km`;


            content.appendChild(
              dot
            );

          }


          /* -------------------------
             Badminton
             ------------------------- */

          if (entries.badminton) {

            const dot =
              document.createElement("i");


            dot.className =
              "mark mark-bad";


            dot.title =
              "Badminton";


            content.appendChild(
              dot
            );

          }


          /* -------------------------
             Nothing logged
             ------------------------- */

          if (
            !content.childElementCount
          ) {

            content.classList.add(
              "mark-none"
            );


            content.textContent =
              "·";

          }


          /*
           * THIS IS THE IMPORTANT PART.
           *
           * Any date in the season that
           * is today or earlier can be edited.
           *
           * There is NO 36-hour limit.
           */

          if (
            canEdit(member.uid) &&
            inSeason(date)
          ) {

            const btn =
              document.createElement(
                "button"
              );


            btn.type =
              "button";


            btn.className =
              "cell-edit";


            btn.appendChild(
              content
            );


            btn.title =
              `Edit ${member.name} · ${date}`;


            btn.addEventListener(
              "click",
              () =>
                openEditor(
                  member,
                  date,
                  entries
                )
            );


            td.appendChild(
              btn
            );

          } else {

            td.appendChild(
              content
            );

          }


          tr.appendChild(td);

        }
      );


      tbody.appendChild(
        tr
      );

    }
  );
}


/* =========================================================
   EDIT SHEET
   ========================================================= */

function openEditor(
  member,
  date,
  entries
) {

  /*
   * Extra client-side protection:
   *
   * Never open the editor for a future
   * or out-of-season date.
   */

  if (!canEdit(member.uid)) {

    return;
  }


  if (!inSeason(date)) {

    return;
  }


  editing = {
    member,
    date,
  };


  el("editor-error").textContent =
    "";


  el("editor-who").textContent =
    member.uid === currentUser.uid
      ? "Your record"
      : member.name ||
        member.email;


  el("editor-when").textContent =
    parseDateStr(date)
      .toLocaleDateString(
        undefined,
        {
          weekday: "long",
          day: "numeric",
          month: "long",
        }
      );


  el("edit-run").checked =
    Boolean(entries.run);


  el("edit-km").value =
    entries.run
      ? entries.run.distanceKm
      : "";


  el("edit-badminton").checked =
    Boolean(
      entries.badminton
    );


  syncKmField();


  el("editor").showModal();
}


/* =========================================================
   EDITOR DISTANCE FIELD
   ========================================================= */

function syncKmField() {

  el("edit-km").disabled =
    !el("edit-run").checked;
}


el("edit-run").addEventListener(
  "change",
  syncKmField
);


el("editor-cancel").addEventListener(
  "click",
  () =>
    el("editor").close()
);


/* =========================================================
   SAVE EDIT
   ========================================================= */

el("editor-save").addEventListener(
  "click",
  async () => {

    if (!editing) {

      return;
    }


    const {
      member,
      date
    } = editing;


    /*
     * Client-side safety checks.
     */

    if (!canEdit(member.uid)) {

      el("editor-error").textContent =
        "You can only edit your own records.";

      return;
    }


    if (!inSeason(date)) {

      el("editor-error").textContent =
        "This date cannot be edited.";

      return;
    }


    const wantRun =
      el("edit-run").checked;


    const wantBad =
      el("edit-badminton").checked;


    const km =
      parseFloat(
        el("edit-km").value
      );


    if (
      wantRun &&
      (
        !Number.isFinite(km) ||
        km <= 0
      )
    ) {

      el("editor-error").textContent =
        "Enter the distance for the run.";

      return;
    }


    if (
      wantRun &&
      km > 200
    ) {

      el("editor-error").textContent =
        "Run distance cannot exceed 200km.";

      return;
    }


    const saveBtn =
      el("editor-save");


    saveBtn.disabled = true;


    el("editor-error").textContent =
      "";


    try {

      const ops = [];


      /* -------------------------
         Run
         ------------------------- */

      if (wantRun) {

        ops.push(
          writeLog(
            member,
            date,
            "run",
            km
          )
        );

      } else {

        ops.push(
          deleteDoc(
            doc(
              db,
              "logs",
              logId(
                member.uid,
                date,
                "run"
              )
            )
          )
        );

      }


      /* -------------------------
         Badminton
         ------------------------- */

      if (wantBad) {

        ops.push(
          writeLog(
            member,
            date,
            "badminton",
            0
          )
        );

      } else {

        ops.push(
          deleteDoc(
            doc(
              db,
              "logs",
              logId(
                member.uid,
                date,
                "badminton"
              )
            )
          )
        );

      }


      /*
       * Wait for ALL writes/deletes.
       *
       * Do not silently swallow Firestore
       * permission errors.
       */

      await Promise.all(
        ops
      );


      el("editor").close();


      await Promise.all([
        loadMyToday(),
        loadWeek(),
      ]);


    } catch (err) {

      console.error(
        "Failed to save edited record:",
        err
      );


      el("editor-error").textContent =
        `Couldn't save: ${err.message}`;


    } finally {

      saveBtn.disabled = false;

    }

  }
);
