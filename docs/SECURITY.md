# Security

- Never store seed phrases in the repository, env files committed to git, or LLM prompts.
- `.gitignore` covers `.env`, keys, keystores, wallet dumps, `secrets/`.
- Live credentials, if ever used, must be withdrawal-disabled API keys on a dedicated hot wallet with limited funds.
- The LLM is not an authority for balances, fills, keys, or contract safety.
- Unowned database rows are world-readable through public server functions — **no personal data, emails, names, or API keys**.
- Health errors and ingest logs are redacted before they reach the public desk.
- `VITE_` variables reach the browser. Never put secrets there.
- Live submission cannot be armed by the presence of an API key.
- Twice-daily desk notes are emailed privately. The public site shows only that a note was built, never the recipient.

If a secret appears in a log, chat, or git history, rotate it immediately. X keys pasted into chat should be rotated at developer.x.com after this desk is confirmed working.
