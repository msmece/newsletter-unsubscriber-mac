# Architecture

```text
Renderer (DOM + local scan history)
    ↕ limited, validated IPC
Preload (contextBridge)
    ↕
Main process
    ├─ auth.ts       MSAL device-code authentication + encrypted token cache
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
`renderer/src/storage.ts` stores scan history and merges statuses on rescans.

Configuration and credentials are main-process concerns. Public registration IDs are
loaded at runtime; missing configuration produces a sign-in error, not a startup crash.
Activity records deliberately omit request credentials and personalized URL components.

Development uses the local Vite server. Packaged builds load the bundled renderer.
There is no telemetry service, cloud storage, automatic updater, or background scheduler.

Tests compile isolated TypeScript modules into a Node VM with mocked Electron/network
boundaries. They verify application behavior without launching a mailbox session.
