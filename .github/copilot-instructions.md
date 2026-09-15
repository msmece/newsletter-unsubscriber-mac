# Contributor context

Read README.md, CONTRIBUTING.md, and SECURITY.md before making changes.

- Electron + TypeScript. Main process owns authentication and networking.
- The sandboxed renderer uses only the narrowly defined preload API.
- Never commit real accounts, tenant identifiers, local paths, tokens, mailbox fixtures,
  unsubscribe URLs, or screenshots containing personal data.
- Use .env for local configuration; .env.example contains placeholders only.
- Tests use example.com and mocked services; never send real unsubscribe requests in tests.
- Keep activity records free of credentials, message contents, and personalized links.
- Run npm run check and npm audit before proposing a release.
- Do not change repository visibility, publish binaries, or rewrite remote history without approval.
