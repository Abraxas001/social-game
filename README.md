# Blockhaven (working title)

A browser-based, block-world social sandbox. Create an avatar, pick a map, and
build, explore and hang out together in real time.

> **Status:** MVP scaffold. It was written without being able to install
> dependencies, so it has **not been run or type-checked yet**. Expect to fix a
> few small errors on the first `npm run dev`.

## What's in the MVP

- Avatar builder (name + skin, hair, shirt, pants colours) with a live 3D preview
- Three maps: Meadow, Dune Sea, Frost Peaks (deterministic terrain, shared by every player)
- Voxel world rendered with Three.js (chunked meshes, face culling)
- First-person controls: walk, sprint, jump, fly, break and place blocks
- Multiplayer rooms (up to 8 players) over WebSockets, with invite links
- Shared block edits, text chat, name tags, walking animation for other players

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. The game server listens on port 3001.
Share the invite link (or the `?room=` code) with a friend on the same network.

Set `VITE_WS_URL` (for example `wss://your-host`) if the server is not on the
same hostname as the page.

## Deploy for free

The client is static files and the server is a long-running WebSocket process,
so they go on two different free hosts.

**1. Server on Render (free web service)**

1. In Render, choose *New > Blueprint* and select this repo. It reads `render.yaml`.
   (Or create a Web Service by hand: build `npm install`, start `npm run start -w @sg/server`, health check `/health`.)
2. Copy the service URL, for example `https://blockhaven-server.onrender.com`.

**2. Client on Vercel (Hobby plan)**

1. Import the repo in Vercel. `vercel.json` sets the build and output folder.
2. Add the environment variable `VITE_WS_URL=wss://blockhaven-server.onrender.com` (use your own URL, with `wss://`).
3. Deploy.

Free-tier trade-offs:

- Render sleeps the server after 15 minutes without traffic. The first player
  waits about a minute while it wakes; the client shows a message and retries.
  Open WebSocket connections count as traffic, so it stays awake during play.
- Rooms and block edits live in server memory, so they are lost when the server
  restarts or sleeps. Saved worlds need a database (a later step).
- Free instances are limited to one instance and 750 hours a month, which covers
  one always-on service.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Space | Jump (fly up while flying) |
| Shift | Sprint (fly down while flying) |
| F | Toggle fly |
| Left click | Break block |
| Right click | Place block |
| 1-9 / mouse wheel | Choose block |
| Enter | Chat |

## Layout

```
packages/
  shared/   constants, protocol types, terrain generation
  server/   Node.js WebSocket server (rooms, validation, rate limits)
  client/   Vite + TypeScript + Three.js game client
```

## Roadmap

See the concept draft for the full list. Next up:

1. Accounts and saved home worlds (PostgreSQL)
2. Proximity voice chat (WebRTC)
3. Touch controls for mobile
4. Mini-games: parkour, build battle
5. Map editor and sharing gallery
6. Moderation tools (report, mute, block) before any public launch
