/**
 * Security rules tests.
 *
 * Run with:
 *   npm install --save-dev @firebase/rules-unit-testing firebase firebase-tools
 *   npx firebase emulators:exec --only firestore --project demo-test "node rules.test.mjs"
 *
 * Requires Java (the Firestore emulator runs on the JVM).
 */
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, deleteDoc, getDocs, collection } from "firebase/firestore";
import fs from "fs";

const ALICE = "alice_uid";
const BOB = "bob_uid";
const ADMIN = "admin_uid";

// Must match the season start in firestore.rules.
const SEASON_START = "2026-08-31";

function dayOffset(n = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const logId = (uid, date, activity) => `${uid}_${date}_${activity}`;
const entry = (uid, date, activity, distanceKm = 0, name = "Test", durationSec = 0) => ({
  uid, name, date, activity, distanceKm, durationSec,
});

let passed = 0, failed = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${label}\n        ${err.message.split("\n")[0]}`);
    failed++;
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: "attendance-rules-test",
  firestore: {
    rules: fs.readFileSync("firestore.rules", "utf8"),
    host: "127.0.0.1",
    port: 8080,
  },
});

await testEnv.clearFirestore();

// Seed the admin grant with rules bypassed, mirroring how you'd add it
// from the Firebase console.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), "admins", ADMIN), { grantedAt: "seed" });
});

const alice = testEnv.authenticatedContext(ALICE).firestore();
const bob = testEnv.authenticatedContext(BOB).firestore();
const admin = testEnv.authenticatedContext(ADMIN).firestore();
const anon = testEnv.unauthenticatedContext().firestore();

console.log("\nvisibility — the whole team sees everything");
await check("signed-in user reads the roster", () =>
  assertSucceeds(getDocs(collection(alice, "members"))));
await check("signed-in user reads everyone's logs", () =>
  assertSucceeds(getDocs(collection(bob, "logs"))));
await check("signed-out user reads nothing", () =>
  assertFails(getDocs(collection(anon, "logs"))));

console.log("\nmembers/");
await check("can create own member doc", () =>
  assertSucceeds(setDoc(doc(alice, "members", ALICE),
    { uid: ALICE, name: "Alice", email: "a@x.com" })));
await check("cannot write someone else's member doc", () =>
  assertFails(setDoc(doc(alice, "members", BOB), { uid: BOB, name: "Hacked" })));

console.log("\nlogs/ — own records");
await check("can log own run today", () =>
  assertSucceeds(setDoc(doc(alice, "logs", logId(ALICE, dayOffset(), "run")),
    entry(ALICE, dayOffset(), "run", 3.5, "Alice"))));
await check("can log own badminton today", () =>
  assertSucceeds(setDoc(doc(alice, "logs", logId(ALICE, dayOffset(), "badminton")),
    entry(ALICE, dayOffset(), "badminton", 0, "Alice"))));
await check("can edit own PAST record (10 days ago)", () =>
  assertSucceeds(setDoc(doc(alice, "logs", logId(ALICE, dayOffset(-10), "run")),
    entry(ALICE, dayOffset(-10), "run", 4, "Alice"))));
await check("can edit own record back on the season opener", () =>
  assertSucceeds(setDoc(doc(alice, "logs", logId(ALICE, SEASON_START, "run")),
    entry(ALICE, SEASON_START, "run", 5, "Alice"))));
await check("can delete own log", () =>
  assertSucceeds(deleteDoc(doc(alice, "logs", logId(ALICE, dayOffset(), "badminton")))));

console.log("\nlogs/ — admin");
await check("admin can log on someone else's behalf", () =>
  assertSucceeds(setDoc(doc(admin, "logs", logId(BOB, dayOffset(), "run")),
    entry(BOB, dayOffset(), "run", 6, "Bob"))));
await check("admin can edit someone's past record", () =>
  assertSucceeds(setDoc(doc(admin, "logs", logId(BOB, dayOffset(-5), "badminton")),
    entry(BOB, dayOffset(-5), "badminton", 0, "Bob"))));
await check("admin can delete someone else's log", () =>
  assertSucceeds(deleteDoc(doc(admin, "logs", logId(BOB, dayOffset(), "run")))));

console.log("\nlogs/ — abuse");
await check("non-admin cannot log for someone else", () =>
  assertFails(setDoc(doc(bob, "logs", logId(ALICE, dayOffset(), "run")),
    entry(ALICE, dayOffset(), "run", 5, "Alice"))));
await check("non-admin cannot delete someone else's log", () =>
  assertFails(deleteDoc(doc(bob, "logs", logId(ALICE, dayOffset(), "run")))));
await check("cannot mismatch doc id and payload", () =>
  assertFails(setDoc(doc(alice, "logs", logId(ALICE, dayOffset(), "badminton")),
    entry(ALICE, dayOffset(), "run", 5, "Alice"))));
await check("cannot log before the season start", () =>
  assertFails(setDoc(doc(alice, "logs", logId(ALICE, "2026-08-25", "run")),
    entry(ALICE, "2026-08-25", "run", 5, "Alice"))));
await check("can log a run with a duration", () =>
  assertSucceeds(setDoc(doc(alice, "logs", logId(ALICE, dayOffset(-2), "run")),
    entry(ALICE, dayOffset(-2), "run", 5, "Alice", 1710))));
await check("legacy write without durationSec still accepted", () =>
  assertSucceeds(setDoc(doc(alice, "logs", logId(ALICE, dayOffset(-3), "run")),
    { uid: ALICE, name: "Alice", date: dayOffset(-3), activity: "run", distanceKm: 5 })));
await check("cannot log an absurd duration", () =>
  assertFails(setDoc(doc(alice, "logs", logId(ALICE, dayOffset(), "run")),
    entry(ALICE, dayOffset(), "run", 5, "Alice", 999999))));
await check("cannot pre-log a week into the future", () =>
  assertFails(setDoc(doc(alice, "logs", logId(ALICE, dayOffset(7), "run")),
    entry(ALICE, dayOffset(7), "run", 5, "Alice"))));
await check("cannot log an invented activity", () =>
  assertFails(setDoc(doc(alice, "logs", logId(ALICE, dayOffset(), "cycling")),
    entry(ALICE, dayOffset(), "cycling", 20, "Alice"))));
await check("cannot log an absurd distance", () =>
  assertFails(setDoc(doc(alice, "logs", logId(ALICE, dayOffset(), "run")),
    entry(ALICE, dayOffset(), "run", 9999, "Alice"))));
await check("signed-out user cannot write", () =>
  assertFails(setDoc(doc(anon, "logs", logId(ALICE, dayOffset(), "run")),
    entry(ALICE, dayOffset(), "run", 5, "Alice"))));

console.log("\nadmins/ — cannot be self-granted");
await check("user cannot make themselves admin", () =>
  assertFails(setDoc(doc(alice, "admins", ALICE), { granted: true })));
await check("admin cannot grant admin to others from the app", () =>
  assertFails(setDoc(doc(admin, "admins", BOB), { granted: true })));
await check("signed-in user can read the admin list", () =>
  assertSucceeds(getDocs(collection(alice, "admins"))));

console.log("\nother collections");
await check("arbitrary collections unreachable", () =>
  assertFails(setDoc(doc(alice, "secrets", "x"), { a: 1 })));

await testEnv.cleanup();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
