// Paste your Firebase web app config here.
// Firebase Console → Project settings → General → Your apps → Web app → Config
//
// These values are NOT secrets — they're meant to be public in client-side code.
// Your data is protected by the Firestore security rules (firestore.rules),
// not by hiding these.
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAMYpcA-CszI3zejdDeApHbNo4Qoq1ixVw",
  authDomain: "baddy-b76e2.firebaseapp.com",
  databaseURL: "https://baddy-b76e2-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "baddy-b76e2",
  storageBucket: "baddy-b76e2.firebasestorage.app",
  messagingSenderId: "116176626095",
  appId: "1:116176626095:web:ed00d223ea08c2467f8f5a"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Attendance rules — change these to match your team.
export const RULES = {
  minRunKm: 2,
  windowLabel: "6:30–7:30 PM",
  activeDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};
