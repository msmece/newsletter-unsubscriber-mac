# Contributing

Use Node 22 (22.16 or newer) and run `npm ci`. Copy `.env.example` to `.env` only if
you need live Microsoft sign-in; automated checks do not require an account.

Before submitting a pull request:

1. Keep the change focused and explain the user-visible behavior.
2. Add regression tests for security boundaries and substantive behavior changes.
3. Run `npm run check` and `npm audit`.
4. Use synthetic accounts under `example.com` in tests and screenshots.
5. Review your diff for credentials, registration IDs, local paths, email contents,
   and personalized unsubscribe links. Never commit `.env` or app-data directories.
6. Describe what you tested and any remaining limits. Do not claim live service or
   packaging validation unless you actually performed it.

Use GitHub's noreply email for commits if you do not want your personal email exposed.
Discuss breaking changes in an issue first. Report security issues through SECURITY.md.

Contributions are provided under this repository's MIT license. Keep third-party
license notices when copying or redistributing code. Communicate respectfully and
focus feedback on the work; harassment and disclosure of others' personal data are
not acceptable.
