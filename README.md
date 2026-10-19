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
