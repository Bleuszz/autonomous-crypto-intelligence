import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactSecrets, sanitizePublicError, looksLikeSecretKey } from "./privacy.ts";

describe("privacy redaction", () => {
  it("strips bearer tokens, emails and env assignments", () => {
    const raw =
      "Authorization: Bearer AAAAAAAAAAAAAAAAAAAAAxxxx " +
      "X_BEARER_TOKEN=abc123 user@example.com hex " +
      "0123456789abcdef0123456789abcdef01234567";
    const out = redactSecrets(raw);
    assert.equal(out.includes("AAAAAAAAAAAAAAAAAAAA"), false);
    assert.equal(out.includes("user@example.com"), false);
    assert.equal(out.includes("abc123"), false);
    assert.match(out, /redacted/i);
  });

  it("does not leak a secret-looking health error", () => {
    const s = sanitizePublicError("api_key invalid for bearer");
    assert.ok(s);
    assert.equal(s.includes("api_key invalid for bearer") && s.includes("bearer"), false);
  });

  it("flags secret-like env names", () => {
    assert.equal(looksLikeSecretKey("X_BEARER_TOKEN"), true);
    assert.equal(looksLikeSecretKey("TRADING_MODE"), false);
  });
});
