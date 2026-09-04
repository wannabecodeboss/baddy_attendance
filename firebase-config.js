// Firebase web app config.
//
// No imports and no initializeApp() here — app.js loads Firebase from the CDN
// and does the initializing. This file only exports plain values.
//
// These values are NOT secrets; they're meant to be public in client-side code.
// Your data is protected by the Firestore security rules (firestore.rules).

export const firebaseConfig = {
  apiKey: "AIzaSyAMYpcA-CszI3zejdDeApHbNo4Qoq1ixVw",
  authDomain: "baddy-b76e2.firebaseapp.com",
  databaseURL: "https://baddy-b76e2-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "baddy-b76e2",
  storageBucket: "baddy-b76e2.firebasestorage.app",
  messagingSenderId: "116176626095",
  appId: "1:116176626095:web:ed00d223ea08c2467f8f5a",
};

// Attendance rules — change these to match your team.
//
// IMPORTANT: seasonStart is also hard-coded in firestore.rules. If you change
// it here, change it there too and redeploy the rules, or the server will keep
// rejecting logs the app thinks are valid.
export const RULES = {
  seasonStart: "2026-08-31",
  minRunKm: 2,
  windowLabel: "6:30–7:30 PM",
  activeDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],

  // The challenge ladder. Flip this on only after an admin has seeded the
  // ranks (see README). While it's false, leaderboard.html shows a short
  // "not open yet" note instead of the ladder.
  ladderEnabled: false,
  // How far apart two players' ranks may be for a legal challenge.
  // NOTE: this "2" is also hard-coded in firestore.rules (absDiff checks in
  // validMatch / validParticipantRankUpdate). Change both together.
  challengeGap: 2,
  // Longest accepted score string, e.g. "21-15, 19-21, 21-18".
  maxScoreLen: 40,
};

// The two ladders. Keys are what's stored on member/rank docs as `gender`;
// labels are what the UI shows. Kept here so there's one place to relabel.
export const LADDERS = [
  { key: "M", label: "Men" },
  { key: "F", label: "Women" },
];
