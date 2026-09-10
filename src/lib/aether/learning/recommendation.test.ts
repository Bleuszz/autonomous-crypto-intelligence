import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coerceLearnerRecommendation,
  jsonbField,
  parseLearnerRecommendation,
  predictionFromRecommendationField,
  predictionStatus,
} from "./recommendation.ts";

test("jsonbField treats JSON-null and the string null as null", () => {
  assert.equal(jsonbField(null), null);
  assert.equal(jsonbField(undefined), null);
  assert.equal(jsonbField("null"), null);
  assert.deepEqual(jsonbField('{\"action\":\"ENTER\"}'), { action: "ENTER" });
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

test("predictionFromRecommendationField is the /learning null.action regression", () => {
  for (const raw of [null, "null", {}, { action: null }, { action: "ENTER", confidence: 0.4, expectedReward: 0.1, reasons: ["ok"] }]) {
    const view = predictionFromRecommendationField(raw, null);
    assert.equal(typeof view.predictedAction, "string");
    assert.ok(view.predictedAction);
  }
  const missing = predictionFromRecommendationField(null, null);
  assert.equal(missing.predictedAction, "WAIT");
  assert.equal(missing.status, "NO DATA");
  const unresolved = predictionFromRecommendationField({ action: "WAIT", confidence: 0, expectedReward: 0, reasons: ["shadow"] }, null);
  assert.equal(unresolved.status, "UNRESOLVED");
  const nodata = predictionFromRecommendationField({ action: null }, 0.1);
  assert.equal(nodata.predictedAction, "WAIT");
  assert.equal(nodata.status, "NO DATA");
});
