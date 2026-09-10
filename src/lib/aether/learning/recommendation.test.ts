import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coerceLearnerRecommendation,
  jsonbField,
  parseLearnerRecommendation,
  predictionStatus,
} from "./recommendation.ts";

test("jsonbField treats JSON-null and the string null as null", () => {
  assert.equal(jsonbField(null), null);
  assert.equal(jsonbField(undefined), null);
  assert.equal(jsonbField("null"), null);
  assert.deepEqual(jsonbField('{"action":"ENTER"}'), { action: "ENTER" });
  assert.equal(jsonbField("{not-json"), null);
});

test("parseLearnerRecommendation rejects null action objects", () => {
  assert.equal(parseLearnerRecommendation(null), null);
  assert.equal(parseLearnerRecommendation("null"), null);
  assert.equal(parseLearnerRecommendation({}), null);
  assert.equal(parseLearnerRecommendation({ action: null }), null);
  assert.equal(parseLearnerRecommendation({ action: "HOPE" }), null);
  const ok = parseLearnerRecommendation({ action: "ENTER", expectedReward: 0.2, confidence: 0.7, reasons: ["x"] });
  assert.equal(ok?.action, "ENTER");
});

test("coerceLearnerRecommendation never throws on null.action", () => {
  const recs = [null, "null", {}, { action: null }, { action: "WAIT" }];
  for (const raw of recs) {
    const rec = coerceLearnerRecommendation(raw);
    assert.ok(["ENTER", "WAIT", "REJECT", "EXIT"].includes(rec.action));
  }
  assert.equal(predictionStatus({ resolved: false, recommendation: coerceLearnerRecommendation(null) }), "UNRESOLVED");
  assert.equal(predictionStatus({ resolved: true, recommendation: null }), "NO DATA");
});
