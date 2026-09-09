import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyXCall,
  decodeSecret,
  emptyXBudget,
  shouldCallX,
  weekStartMs,
  X_DAILY_CAP,
  X_MIN_INTERVAL_MS,
} from "./xbudget.ts";

describe("x budget", () => {
  it("decodes percent-encoded bearers and leaves raw tokens alone", () => {
    assert.equal(decodeSecret("abc%2Fdef%3Dgh"), "abc/def=gh");
    assert.equal(decodeSecret("plain-token"), "plain-token");
  });

  it("refuses a second call inside the min interval", () => {
    const now = Date.UTC(2026, 8, 9, 12, 0, 0);
    const s = emptyXBudget(now);
    const after = applyXCall(s, { ok: true, status: 200, error: null, tweets: 10 }, now);
    const again = shouldCallX(after, now + 60_000);
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.reason, "min interval");
    const later = shouldCallX(after, now + X_MIN_INTERVAL_MS + 1);
    assert.equal(later.ok, true);
  });

  it("enforces the daily cap and backs off on 429", () => {
    const now = Date.UTC(2026, 8, 9, 8, 0, 0);
    let s = emptyXBudget(now);
    for (let i = 0; i < X_DAILY_CAP; i++) {
      s = applyXCall(s, { ok: true, status: 200, error: null, tweets: 10 }, now);
    }
    const blocked = shouldCallX(s, now + X_MIN_INTERVAL_MS + 1);
    assert.equal(blocked.ok, false);
    const backed = applyXCall(emptyXBudget(now), { ok: false, status: 429, error: "http 429", tweets: 0 }, now);
    const wait = shouldCallX(backed, now + 60_000);
    assert.equal(wait.ok, false);
  });

  it("resets the week on the following Monday UTC", () => {
    const wednesday = Date.UTC(2026, 8, 9, 12, 0, 0);
    const monday = weekStartMs(wednesday);
    assert.equal(new Date(monday).getUTCDay(), 1);
  });
});
