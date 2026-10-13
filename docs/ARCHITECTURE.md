# Architecture

```text
Renderer (DOM + current session state)
    ↕ limited, validated IPC
Preload (contextBridge)
    ↕
Main process
    ├─ auth.ts       MSAL device-code authentication + encrypted token cache
    ├─ history.ts    encrypted history + atomic persistence / session fallback
    ├─ password-history.ts ciphertext file storage, without password/key access
    ├─ secure-storage.ts OS encryption availability, excluding basic_text
    ├─ config.ts     ignored local config / environment
    ├─ graph.ts      mailbox folder traversal and newsletter grouping
    ├─ unsubscribe.ts one-click POST or manual completion
    ├─ network.ts    public-address validation and constrained HTTPS transport
    ├─ activity.ts   bounded request log and external app handoffs
    └─ validation.ts IPC argument validation
```

`src/shared/types.ts` defines the IPC data contracts. The renderer creates text nodes
for mailbox fields rather than injecting HTML. It does not fetch remote resources.
`renderer/src/bulk.ts` coordinates sequential requests and the domain failure guard.
`renderer/src/storage.ts` uses validated IPC for encrypted history, migrates legacy
browser storage, and merges statuses on rescans. It never writes new plaintext history.

`shared/newsletter.ts` defines case-preserving identities and link ordering. Each
unsubscribe link retains its own message's one-click flag and received time; the
legacy aggregate flag never authorizes a POST. A list retains the newest 100 link
alternatives plus its original identity URL. An action tries at most five automatic
alternatives, stopping on rate limiting, before manual browser/email fallbacks.
Legacy saved identities migrate locally; rescans supply per-link metadata. Newer
delivery reopens completed entries, and partial scans preserve earlier history.

Configuration and credentials are main-process concerns. Public registration IDs are
loaded at runtime; missing configuration produces a sign-in error, not a startup crash.
Authentication reads the encrypted cache once per client and keeps a current serialized
snapshot in memory. Every MSAL cache access restores that snapshot because silent token
acquisition clears storage through `overwriteCache()`. If secure persistence fails,
the session continues with a visible notice. Sign-out clears
accounts and removes the saved cache even when Keychain access is unavailable.
History uses AES-256-GCM with a fresh random key/nonce per write and OS-backed key
wrapping. Migration removes Chromium local storage only after encryption is committed.
Denied Keychain access leaves new history in memory and legacy migration visibly pending.
Alternatively, `renderer/src/history-crypto.ts` derives a non-extractable Web Crypto
key from an app-local password using PBKDF2-HMAC-SHA256 and encrypts history using
AES-256-GCM. The preload transfers only ciphertext to `password-history.ts`.
Saved history remains locked until the password is entered on each renderer/app
restart. Browser backups from renderer-only updates are authenticated before being
committed to the file and before legacy database cleanup. The renderer prefers
the live main-process snapshot to stale legacy data when preserving a current session.
Activity records deliberately omit request credentials and personalized URL components.

Development uses the local Vite server. Packaged builds load the bundled renderer.
There is no telemetry service, cloud storage, automatic updater, or background scheduler.

Tests compile isolated TypeScript modules into a Node VM with mocked Electron/network
boundaries. They verify application behavior without launching a mailbox session.
