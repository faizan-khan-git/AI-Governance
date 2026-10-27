import test from "node:test";
import assert from "node:assert/strict";

import { buildHistory } from "./history.js";

const LIMITS = { maxMessages: 6, maxChars: 100 };
const u = (content) => ({ role: "user", content });
const a = (content) => ({ role: "assistant", content });

test("an empty transcript gives an empty history", () => {
  assert.deepEqual(buildHistory([], LIMITS), []);
});

test("complete exchanges are kept in order", () => {
  assert.deepEqual(buildHistory([u("q1"), a("a1"), u("q2"), a("a2")], LIMITS), [
    u("q1"),
    a("a1"),
    u("q2"),
    a("a2"),
  ]);
});

test("a trailing unanswered message is not part of the history", () => {
  assert.deepEqual(buildHistory([u("q1"), a("a1"), u("q2")], LIMITS), [u("q1"), a("a1")]);
});

test("a failed prompt (no reply) is skipped and does not break alternation", () => {
  const transcript = [u("q1"), a("a1"), u("failed prompt"), u("q2"), a("a2")];
  assert.deepEqual(buildHistory(transcript, LIMITS), [u("q1"), a("a1"), u("q2"), a("a2")]);
});

test("an empty assistant reply drops its exchange", () => {
  assert.deepEqual(buildHistory([u("q1"), a(""), u("q2"), a("a2")], LIMITS), [u("q2"), a("a2")]);
});

test("only the most recent exchanges fit the message limit", () => {
  const transcript = [u("q1"), a("a1"), u("q2"), a("a2"), u("q3"), a("a3"), u("q4"), a("a4")];
  assert.deepEqual(buildHistory(transcript, { maxMessages: 4, maxChars: 1000 }), [
    u("q3"),
    a("a3"),
    u("q4"),
    a("a4"),
  ]);
});

test("the character limit drops the oldest exchanges first and never splits one", () => {
  const transcript = [u("a".repeat(40)), a("b".repeat(40)), u("c".repeat(10)), a("d".repeat(10))];
  // 100 chars allowed: newest exchange (20) fits, older (80) would make 100 -> still fits
  assert.equal(buildHistory(transcript, { maxMessages: 10, maxChars: 100 }).length, 4);
  // 90 chars allowed: the older exchange no longer fits, so only the newest remains
  assert.deepEqual(buildHistory(transcript, { maxMessages: 10, maxChars: 90 }), [
    u("c".repeat(10)),
    a("d".repeat(10)),
  ]);
});

test("a single exchange larger than the limit yields no history rather than half of it", () => {
  assert.deepEqual(buildHistory([u("x".repeat(80)), a("y".repeat(80))], LIMITS), []);
});

test("extra message fields are not forwarded", () => {
  const transcript = [
    { role: "user", content: "q", id: "1", createdAt: "now" },
    { role: "assistant", content: "a", id: "2", meta: { usage: 1 } },
  ];
  assert.deepEqual(buildHistory(transcript, LIMITS), [u("q"), a("a")]);
});
