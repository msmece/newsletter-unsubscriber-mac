# Download and run

Download **arm64** for Apple Silicon Macs (M1 and newer) or **x64** for Intel Macs.
The DMG contains the app and an Applications shortcut. The ZIP contains the same app.
SHA-256 checksum files accompany the downloads.

Builds are ad-hoc signed, without an Apple Developer ID certificate or notarization.
macOS may block the first launch. After attempting to open the app, use
**System Settings → Privacy & Security → Open Anyway** only for a download you trust.
See [Apple's instructions](https://support.apple.com/en-us/102445).

Microsoft sign-in requires your own public-client Microsoft application registration
and a local `config.json`. Follow [Microsoft account setup](MICROSOFT_SETUP.md).
No personal Microsoft configuration, account tokens, or mailbox history are bundled.

## Build downloads

Each successful **Checks and macOS downloads** workflow produces two artifacts:
`newsletter-macos-arm64-<commit>` and `newsletter-macos-x64-<commit>`.
Open [Actions](https://github.com/msmece/newsletter-unsubscriber-mac/actions), choose
the completed run, then download an artifact from its summary. You must be signed
into GitHub. These artifacts are retained for **30 days**. The workflow also supports
**Run workflow** to rebuild a selected branch.

## Version releases

Tags matching `v<package.json version>` publish both architectures to
[Releases](https://github.com/msmece/newsletter-unsubscriber-mac/releases) after
all checks and packaging jobs succeed. Release assets remain available beyond the
Actions artifact retention period and can be downloaded without signing into GitHub.
Tags must refer to commits on the default branch. Prerelease versions such as
`v1.1.0-beta.1` are marked as prereleases. Existing published version assets are
retained when a workflow is rerun.

After a version change has been reviewed and merged, publish its tag:

```sh
git switch main
git pull --ff-only
git tag v1.1.0
git push origin v1.1.0
```

The example requires `package.json` and `package-lock.json` to already contain
version `1.1.0`. A mismatched tag fails before packaging or release publication.
