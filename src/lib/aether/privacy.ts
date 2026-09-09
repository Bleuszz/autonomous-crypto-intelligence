/**
 * Public-site redaction. Unowned rows and HTML are world-readable.
 * Never leak keys, tokens, emails, or person names into DTOs.
 */

const SECRET_LINE =
  /\b(bearer|authorization|api[_-]?key|api[_-]?secret|x[_-]?bearer|consumer[_-]?secret|private[_-]?key|password|passwd|secret|token|mnemonic|seed phrase|keystore)\b/i;

const JWTISH = /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const BEARER_WORD = /\bBearer\s+\S+/gi;
const HEX_LONG = /\b[a-fA-F0-9]{40,}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PEM = /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g;
const ENV_ASSIGN = /\b(X_BEARER_TOKEN|X_API_KEY|X_API_SECRET|BINANCE_API_KEY|BINANCE_API_SECRET|COINBASE_API_KEY|COINBASE_API_SECRET|XAI_API_KEY|DATABASE_URL|DIGEST_TO)\s*=\s*\S+/gi;

export function redactSecrets(input: string | null | undefined): string {
  if (!input) return "";
  let s = input;
  s = s.replace(PEM, "[redacted-pem]");
  s = s.replace(BEARER_WORD, "Bearer [redacted]");
  s = s.replace(JWTISH, "[redacted-token]");
  s = s.replace(ENV_ASSIGN, "$1=[redacted]");
  s = s.replace(EMAIL, "[redacted-email]");
  s = s.replace(HEX_LONG, "[redacted]");
  if (SECRET_LINE.test(s) && /=/.test(s)) {
    s = s.replace(/=.+$/gm, "=[redacted]");
  }
  return s;
}

export function sanitizePublicError(input: string | null | undefined): string | null {
  if (!input) return null;
  const red = redactSecrets(input).slice(0, 240);
  if (!red.trim()) return null;
  if (SECRET_LINE.test(red) && red.includes("[redacted]") === false) {
    return "provider error (details withheld)";
  }
  return red;
}

export function looksLikeSecretKey(name: string): boolean {
  return /key|secret|token|password|bearer|mnemonic|seed|private/i.test(name);
}

/** Keys that may appear in public health/UI. Presence only, never values. */
export const PUBLIC_FLAG_KEYS = ["TRADING_MODE", "ENABLE_LIVE_TRADING"] as const;
