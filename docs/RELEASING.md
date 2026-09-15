# Publication and release checklist

## Source publication

- [ ] Obtain the maintainer's explicit approval before changing repository visibility.
- [ ] Run `npm ci`, `npm run check`, and `npm audit` from a clean checkout.
- [ ] Run `npm run scan:public` and inspect all tracked binary assets and screenshots.
- [ ] Scan **all Git history and refs**, not just the working tree. A later deletion
      does not remove information from prior commits.
- [ ] Remove private account configuration, local-machine identities, and private
      project notes from the history intended for publication.
- [ ] Review commit author/committer identities. Use a GitHub noreply address if desired.
- [ ] Review GitHub issues, PRs, releases, Actions logs/artifacts, branches and tags;
      making a repository public can expose more than source files.
- [ ] Enable secret scanning/push protection and private vulnerability reporting where
      available. Enable branch protection or a ruleset requiring CI review.
- [ ] Confirm the MIT license and third-party notices are present.
- [ ] Confirm documentation and configuration work for someone with a new registration.

For a repository with private material in its history, prepare a fresh-history copy
of the reviewed source. Keep the original private repository as a backup. Replacing
remote history or creating a replacement public repository requires a separate,
explicit maintainer decision; a normal new commit is not sufficient sanitization.
Do not force-push or change visibility as part of routine validation.

## macOS binary release

- [ ] Build on macOS with `npm run build:mac` using trusted dependencies.
- [ ] Set up Developer ID signing and notarization through your local/CI secrets.
- [ ] Review entitlements and packaged contents; exclude `.env`, credentials, tests,
      and local audit/export files. Runtime dependencies retain their licenses.
- [ ] Inspect the packaged app, test sign-in, scan, manual completion, one-click
      responses, failure skips, sign-out cleanup, and Activity on a clean test account.
- [ ] Test launch on supported macOS versions and architectures; publish the actual
      tested matrix, checksum, and known limitations with release notes.
- [ ] Verify signing/notarization and Gatekeeper acceptance. Do not recommend bypassing
      platform security as a substitute for release signing.
- [ ] Get approval before uploading artifacts or publishing a release.

The repository's unsigned local build is for development. Passing CI does not mean
that a production binary has been signed, notarized, or tested with Microsoft.
