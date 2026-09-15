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
- Scan history is local but unencrypted and may contain personalized unsubscribe links.
  It is not an encrypted vault. Do not share the app-data directory.
- Activity records are bounded and memory-only. Only the fixed, non-personal one-click
  POST payload is recorded. Arbitrary bodies and authorization headers are omitted.

## Limits

No scan, test suite, or dependency audit guarantees that software is vulnerability-free.
Mailbox providers and newsletter senders control responses. HTTP success does not prove
future delivery stopped. No signed/notarized binaries are supplied yet. Build-tool
advisories and Electron/Chromium updates must be reviewed before each release.

Guidance: [Electron security recommendations](https://www.electronjs.org/docs/latest/tutorial/security).
