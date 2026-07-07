# Deploying SKYBREAK to Vercel

The game is a fully static site — no build step, no server code. Multiplayer
duels connect the two players' browsers directly to each other (WebRTC via the
free PeerJS cloud), so Vercel only has to serve the files.

## Steps

1. Push this folder to a GitHub repository (or use `vercel` from the command line).
2. On [vercel.com](https://vercel.com), click **Add New → Project** and import the repo.
3. Framework preset: **Other**. Leave build command empty, output directory `.` —
   the included `vercel.json` already configures this.
4. Deploy. The game is live at your Vercel URL; share it with a friend and both
   click **DUEL** to get matched.

## Notes

- `node_modules`, the local dev server and the `.bat` launcher are excluded via
  `.vercelignore` — everything the site needs (three.js, PeerJS) is vendored
  under `vendor/`.
- Local play/testing still works the same as before: run `Play SKYBREAK.bat`.
- Matchmaking uses the free public PeerJS broker (no account needed). It's
  best-effort: if it's ever down, the matchmaking screen keeps retrying and
  says so. A custom broker can be pointed at with
  `?peerhost=…&peerport=…&peersecure=0` URL parameters (used by the automated
  tests against a local `npx peerjs` server).
- Duels support ~a handful of concurrent players (4 lobby slots), which is the
  intended scale.
