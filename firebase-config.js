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
};
