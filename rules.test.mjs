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
import {
  doc, setDoc, updateDoc, deleteDoc, getDocs, collection, writeBatch,
} from "firebase/firestore";
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

/* ======================= challenge ladder ======================= */

const CARY = "cary_uid";   // men's, rank 5 — out of range of Alice
const DIANA = "diana_uid"; // women's, rank 1
const EVE = "eve_uid";     // signed in, not a participant

const cary = testEnv.authenticatedContext(CARY).firestore();
const diana = testEnv.authenticatedContext(DIANA).firestore();
const eve = testEnv.authenticatedContext(EVE).firestore();

const rank = (uid, gender, r, extra = {}) => ({
  uid, gender, name: uid, rank: r, played: 0, wins: 0, losses: 0, ...extra,
});

// Reset the four rank docs to a known, counter-zeroed state. Called before
// each independent result-batch case so `before.played` is deterministic.
async function freshLadder() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, "ranks", ALICE), rank(ALICE, "M", 1));
    await setDoc(doc(d, "ranks", BOB), rank(BOB, "M", 2));
    await setDoc(doc(d, "ranks", CARY), rank(CARY, "M", 5));
    await setDoc(doc(d, "ranks", DIANA), rank(DIANA, "F", 1));
    await setDoc(doc(d, "members", ALICE), { uid: ALICE, name: "Alice", email: "a@x.com" });
  });
}
await freshLadder();

// A well-formed result batch: match doc + both rank docs, positional swap.
function resultBatch(ctx, authUid, {
  me, opp, meRank, oppRank, meGender = "M",
  winner, matchId, score = "21-15", playedOn = dayOffset(),
  mePlayed = 0, oppPlayed = 0, meDelta = 1,
}) {
  const swap = winner === (meRank > oppRank ? me : opp) && meRank !== oppRank;
  const b = writeBatch(ctx);
  b.set(doc(ctx, "matches", matchId), {
    gender: meGender,
    participants: [me, opp],
    aUid: me, aName: me, bUid: opp, bName: opp,
    winnerUid: winner, score, playedOn, rankSwapped: swap,
    recordedBy: authUid,
  });
  b.update(doc(ctx, "ranks", me), {
    rank: swap ? oppRank : meRank,
    played: mePlayed + meDelta,
    wins: winner === me ? 1 : 0, losses: winner === me ? 0 : 1,
    lastMatchId: matchId, lastMatchWith: opp, updatedBy: authUid,
  });
  b.update(doc(ctx, "ranks", opp), {
    rank: swap ? meRank : oppRank,
    played: oppPlayed + 1,
    wins: winner === opp ? 1 : 0, losses: winner === opp ? 0 : 1,
    lastMatchId: matchId, lastMatchWith: me, updatedBy: authUid,
  });
  return b.commit();
}

const matchDoc = (over = {}) => ({
  gender: "M", participants: [ALICE, BOB],
  aUid: ALICE, aName: "a", bUid: BOB, bName: "b",
  winnerUid: ALICE, score: "21-15", playedOn: dayOffset(),
  rankSwapped: false, recordedBy: ALICE, ...over,
});

console.log("\nranks/ — seeding is admin-only");
await check("admin can create a rank doc", () =>
  assertSucceeds(setDoc(doc(admin, "ranks", "temp_uid"), rank("temp_uid", "M", 9))));
await check("non-admin cannot create a rank doc", () =>
  assertFails(setDoc(doc(alice, "ranks", ALICE), rank(ALICE, "M", 1))));
await check("admin can free-edit any rank", () =>
  assertSucceeds(updateDoc(doc(admin, "ranks", CARY),
    { rank: 3, played: 4, wins: 2, losses: 2 })));
await check("admin rank edit with impossible counters is rejected", () =>
  assertFails(updateDoc(doc(admin, "ranks", CARY),
    { rank: 3, played: 1, wins: 5, losses: 5 })));

console.log("\nmatches/ — recording a result");
await freshLadder();
await check("participant records a legal result (higher seed wins, no swap)", () =>
  assertSucceeds(resultBatch(alice, ALICE, {
    me: ALICE, opp: BOB, meRank: 1, oppRank: 2, winner: ALICE, matchId: "m1",
  })));
await check("participant records a legal upset (lower seed wins, ranks swap)", () =>
  assertSucceeds(resultBatch(bob, BOB, {
    me: BOB, opp: ALICE, meRank: 2, oppRank: 1, winner: BOB, matchId: "m2",
    mePlayed: 1, oppPlayed: 1,
  })));
// Bob is now rank 1, Alice rank 2, both carrying lastMatchId "m2".
await check("replaying the same match id is rejected", () =>
  assertFails(resultBatch(bob, BOB, {
    me: BOB, opp: ALICE, meRank: 1, oppRank: 2, winner: BOB, matchId: "m2",
    mePlayed: 2, oppPlayed: 2,
  })));

console.log("\nmatches/ — abuse + integrity");
await freshLadder();
await check("a non-participant cannot record the match", () =>
  assertFails(resultBatch(eve, EVE, {
    me: ALICE, opp: BOB, meRank: 1, oppRank: 2, winner: ALICE, matchId: "m3",
  })));
await freshLadder();
await check("cannot challenge across ladders", () =>
  assertFails(resultBatch(alice, ALICE, {
    me: ALICE, opp: DIANA, meRank: 1, oppRank: 1, winner: ALICE, matchId: "m4",
  })));
await freshLadder();
await check("cannot challenge someone more than two ranks away", () =>
  assertFails(resultBatch(bob, BOB, {
    me: BOB, opp: CARY, meRank: 2, oppRank: 5, winner: BOB, matchId: "m5",
  })));
await check("cannot record a self-match", () =>
  assertFails(setDoc(doc(bob, "matches", "m6"),
    matchDoc({ participants: [BOB, BOB], aUid: BOB, bUid: BOB, winnerUid: BOB, recordedBy: BOB }))));
await freshLadder();
await check("cannot inflate played by more than one", () =>
  assertFails(resultBatch(bob, BOB, {
    me: BOB, opp: ALICE, meRank: 2, oppRank: 1, winner: BOB, matchId: "m7", meDelta: 3,
  })));
await freshLadder();
await check("cannot save an over-long score", () =>
  assertFails(resultBatch(bob, BOB, {
    me: BOB, opp: ALICE, meRank: 2, oppRank: 1, winner: BOB, matchId: "m8",
    score: "x".repeat(41),
  })));
await freshLadder();
await check("cannot record a match before the season", () =>
  assertFails(resultBatch(bob, BOB, {
    me: BOB, opp: ALICE, meRank: 2, oppRank: 1, winner: BOB, matchId: "m9",
    playedOn: "2026-08-25",
  })));

console.log("\nmatches/ — admin");
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), "matches", "seed_match"), matchDoc());
});
await check("non-admin cannot delete a match", () =>
  assertFails(deleteDoc(doc(bob, "matches", "seed_match"))));
await check("admin can delete a match", () =>
  assertSucceeds(deleteDoc(doc(admin, "matches", "seed_match"))));

console.log("\nmembers/ — gender is set once");
await check("can set own gender the first time", () =>
  assertSucceeds(setDoc(doc(alice, "members", ALICE),
    { uid: ALICE, name: "Alice", email: "a@x.com", gender: "M" }, { merge: true })));
await check("cannot flip own gender afterward", () =>
  assertFails(setDoc(doc(alice, "members", ALICE),
    { uid: ALICE, name: "Alice", email: "a@x.com", gender: "F" }, { merge: true })));
await check("admin can correct someone's gender", () =>
  assertSucceeds(setDoc(doc(admin, "members", ALICE),
    { uid: ALICE, name: "Alice", email: "a@x.com", gender: "F" }, { merge: true })));
await check("gender must be M or F", () =>
  assertFails(setDoc(doc(diana, "members", DIANA),
    { uid: DIANA, name: "Diana", email: "d@x.com", gender: "X" }, { merge: true })));

await testEnv.cleanup();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
