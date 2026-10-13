# Newsletter Unsubscriber for Mac

A desktop app for finding newsletters in your Microsoft mailbox and unsubscribing
from the ones you no longer want. Built with Electron and TypeScript.

**Status:** macOS builds are produced by GitHub Actions for Apple Silicon and Intel.
Downloads are ad-hoc signed; Apple Developer ID signing and notarization are not
configured. Microsoft sign-in requires your own public-client app registration.
See [download and release instructions](docs/DOWNLOADS.md).

![App welcome screen with synthetic newsletter examples](docs/preview.png)

## Features

- Scan selected mail folders for newsletter unsubscribe headers.
- Search results and filter by status.
- Unsubscribe individually or in bulk with supported one-click requests.
- Pause bulk requests for a sender domain after a failure; continue other domains.
- See domain summaries and a plain-language Activity log with request timing,
  destinations, HTTP results, and the one-click POST body.
- Keep scan history locally; no analytics or developer-operated backend.
- Reset all statistics, scan results, completion history, and activity in one action.

## Quick start

Prerequisites: macOS, **Node.js 22.16 or newer in the Node 22 LTS line**, npm, and a
Microsoft account with a mailbox supported by Microsoft Graph. Your organization
may require administrator approval for mail access.

```sh
npm ci
cp .env.example .env
```

Create a Microsoft Entra application registration following
[Microsoft account setup](docs/MICROSOFT_SETUP.md), then fill in `.env`:

```dotenv
AZURE_CLIENT_ID=your-application-client-id
AZURE_TENANT_ID=your-directory-tenant-id
```

These are public-client identifiers, not passwords. Nevertheless, keep your own
configuration local. **Do not create or add a client secret.**

```sh
npm run dev
```

The app opens without a developer-tools window. Use **Continue with Microsoft**,
open Microsoft's verification page, and enter the displayed code. Then select
**Mail folders**, choose folders, and scan. **Activity** shows requests as they run;
connection activity is also available before sign-in.

For a packaged app, configure `config.json` in the app's user-data directory as
described in [setup](docs/MICROSOFT_SETUP.md). Development `.env` files are not bundled.

## How unsubscribe works

A result represents a sender address plus its mailing-list ID (`List-ID`), or its
first unsubscribe URL when no list ID is present. A row displaying “9 messages”
represents nine grouped messages, not nine requests. Message-specific URLs can
still produce duplicate-looking rows. Separate lists on one domain remain separate.

- **One-click HTTPS link:** sends `POST` with content type
  `application/x-www-form-urlencoded` and body `List-Unsubscribe=One-Click`.
  A successful server response is recorded as “Request accepted”; this means the request
  was accepted, not that the sender's future delivery behavior was verified.
- **Other HTTPS links:** opens your browser. Complete the sender's steps, then use
  **Mark as completed**. This is shown as “Marked complete”.
- **Email links:** opens your email app. Review and send the request yourself.
- Insecure HTTP links and unsafe local-network destinations are not opened automatically.
- Requests time out after 30 seconds. Automatic unsubscribe requests do not follow redirects.

One-click support belongs to the URL advertised by that particular message. Grouping
messages never turns a manual link into a one-click link. The app tries newer supported
links first and tries alternatives before opening a manual page or email. Rate limiting
stops further automatic attempts for that entry.

Completed entries still offer **Try again**. If a rescan finds mail received after the
last completed request, the entry returns to **Active** with a notice. Delivery can
take time to stop; new mail does not by itself prove that the sender ignored the request.
Scanning different folders retains earlier entries and unresolved failures.

Results saved by older versions lack per-link capability information. **Rescan your
folders** to refresh those links before using automatic one-click requests. Until then,
saved links require manual completion. URL paths and tokens preserve their original case.

### Bulk behavior

A failed request pauses the **exact sender domain** for the rest of the batch.
Existing unresolved failures also block that domain, even if the failed row is not
selected. A failed request followed by a browser fallback counts as a failure for
this rule. Other domains continue. Subdomains are treated separately.

Skipped rows explain why no request was sent. Individual retries remain available.
A successful individual retry or manually completing the failed entry resolves
that entry's failure. One successful request does **not** automatically unsubscribe
other lists from the same domain.

## Privacy

The app requests delegated `Mail.Read`; it does not request permission to delete or
modify mail. Authentication is handled by Microsoft's MSAL library. Microsoft and
the newsletter sender receive the requests needed to perform their respective actions.

Scan results include sender addresses, subjects, folder names, and personalized
unsubscribe URLs. New history is saved in an **encrypted file**, using AES-256-GCM
and an encryption key protected by Electron `safeStorage` (Keychain on macOS).
If you prefer to deny Keychain access, choose **Encrypt history with a password**
inside the app. Use a long, unique passphrase of at least 12 characters, separate
from your Microsoft password. The app uses AES-256-GCM with a key derived using
PBKDF2-HMAC-SHA256, a random salt, and 600,000 iterations. Only ciphertext and public
encryption parameters are saved; the password and derived key are never persisted.
You must unlock history after each app restart or renderer reload. **Forgotten
history passwords cannot be recovered.**

History is decrypted in memory while the app is running. Encryption protects saved
data; it cannot protect against an attacker who controls the running app or your Mac.
Use **Reset all stats** to remove results, scan totals, completion history, insights,
and activity. Confirm the reset to delete these records; the Microsoft connection
and an unlocked history password remain active. Unlock password-protected history
before resetting it. Signing out clears results and removes
cached accounts. Authentication credentials are stored using Electron `safeStorage`;
the app does not fall back to writing plaintext credentials.
If secure storage is unavailable or cannot be read or written, sign-in can continue
using an in-memory token cache for this app session. A notice explains that you will
need to sign in again after restarting. Existing unreadable credentials are not
overwritten; signing out removes the saved credential cache as well.

History saved by older versions is migrated from browser storage only after an
encrypted file is successfully written. The app then clears its old browser-storage
database. If secure storage is unavailable, **new history stays in memory** and the
app displays a notice. Existing plaintext history is preserved to avoid losing your
results and is explicitly identified as unencrypted until migration can finish.
Allow the app's Keychain access prompt or configure a local history password to
complete that migration. Updating only the UI of a running older app can create
an encrypted browser backup; restart and unlock it to finish file migration and
browser-database cleanup. The app displays a notice until cleanup succeeds.
Deleting an old storage database is not a guarantee of forensic erasure of disk,
backup, or filesystem snapshot copies.

Activity retains the latest 200 steps in memory until the app exits. It omits tokens,
message contents, and personalized URL paths/query strings. The known one-click POST
body is shown because it contains no account information. Clearing activity retains
in-progress requests until they finish.

See [SECURITY.md](SECURITY.md) for boundaries and reporting guidance.

## Development and verification

```sh
npm run check        # formatting, lint, TypeScript, regression tests, production build
npm audit           # current registry advisory check; requires network access
npm start           # build and open the production renderer locally
npm run build:mac   # local macOS package; signing/notarization require separate setup
```

Tests use synthetic addresses and mocked services. They do not connect to a real
mailbox or send unsubscribe requests. Automated checks do not replace testing a real
Microsoft registration or inspecting a signed package on a clean Mac.

- [Architecture](docs/ARCHITECTURE.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Release checklist](docs/RELEASING.md)

## Troubleshooting

| Problem                      | What to do                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| “Sign-in is not configured”  | Fill in `.env` or packaged `config.json`; restart the app.                                      |
| Microsoft rejects sign-in    | Verify the account audience, public-client flow setting, and tenant consent.                    |
| Sign-in expired              | Sign out and reconnect.                                                                         |
| No newsletters found         | Select more folders; only supported unsubscribe headers are detected.                           |
| Request needs action         | Finish the page/email opened by the app, then mark it completed.                                |
| Mail arrives after a request | Rescan for current links and use Try again; a request response does not verify future delivery. |
| Domain skipped               | Retry the failed entry individually; see the bulk behavior above.                               |
| Credentials cannot be saved  | Ensure macOS secure credential storage is available. Plaintext fallback is disabled.            |

## License

[MIT](LICENSE). Third-party dependencies retain their own licenses. This project is
not affiliated with or endorsed by Microsoft. Microsoft and Outlook are trademarks
of their respective owners.
