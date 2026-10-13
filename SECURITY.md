# Security policy

This project is under active development. Security fixes target the latest `main`
branch. There is no promise of support for older builds or a response-time SLA.

## Reporting

Do not put credentials, mailbox data, personalized unsubscribe links, or exploitable
vulnerability details in a public issue. Use GitHub's **Security → Report a
vulnerability** when private vulnerability reporting is enabled. If that option is
unavailable, open a minimal issue asking for a private reporting channel without
including the vulnerability or sensitive data. Maintainers should enable private
vulnerability reporting before making the repository public.

## Boundaries

- Renderer: sandboxed, context-isolated, no Node integration; restrictive CSP.
- IPC: accepts only the main frame at the expected local app URL; validates request
  arguments and exposes a limited preload API.
- Navigation and device permission requests are denied. External links are restricted
  to HTTPS and mailto, with literal local/private addresses rejected.
- Graph requests are restricted to the Microsoft Graph mailbox endpoint. No redirects
  are followed with the authorization header.
- Automated unsubscribe POSTs require HTTPS and public addresses. DNS validation occurs
  inside the connection lookup, including IPv4-mapped IPv6 checks. Redirects are not
  followed. Requests have a 30-second deadline.
- Browser/email handoffs are completed outside the app. HTTPS links can still lead to
  untrusted sender-controlled websites: an allowed scheme is not a trust endorsement.
- Credential cache uses the OS-backed Electron `safeStorage`; no plaintext fallback.
  If secure persistence is unavailable, tokens remain only in MSAL's in-memory cache
  for the current app session. Linux's `basic_text` backend is treated as unavailable.
  Unreadable saved caches are not overwritten; sign-out removes the saved cache file.
- Scan history uses authenticated AES-256-GCM encryption. Each write uses a fresh
  nonce. In Keychain mode, each write uses a fresh key wrapped with OS-backed
  Electron `safeStorage`. In password mode, Web Crypto derives a non-extractable
  AES-256-GCM key with PBKDF2-HMAC-SHA256 (600,000 iterations, random 32-byte salt).
  Neither passwords nor password-derived keys are persisted. Only ciphertext is
  sent to the main process's password-file IPC. History is held in
  decrypted form in app memory during use. Writes are committed through a temporary
  encrypted file and rename. If secure storage is unavailable, new history is session-only.
  A configured history password provides encrypted persistence without Keychain access.
- Legacy browser history is removed after encrypted migration succeeds. If migration
  cannot finish, the original data remains with a visible plaintext warning. Browser
  database deletion does not guarantee forensic erasure or remove backups/snapshots.
  Unreadable encrypted history is preserved rather than overwritten.
- Activity records are bounded and memory-only. Only the fixed, non-personal one-click
  POST payload is recorded. Arbitrary bodies and authorization headers are omitted.

## Limits

No scan, test suite, or dependency audit guarantees that software is vulnerability-free.
Mailbox providers and newsletter senders control responses. HTTP success does not prove
future delivery stopped. CI downloads use ad-hoc signatures; Apple Developer ID
signing and notarization are not configured. Build-tool
advisories and Electron/Chromium updates must be reviewed before each release.

Guidance: [Electron security recommendations](https://www.electronjs.org/docs/latest/tutorial/security).
