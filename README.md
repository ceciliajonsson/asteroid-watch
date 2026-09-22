# Asteroid Watch

A live 3D view of the 20 asteroids passing closest to Earth, with Earth and the Moon in the middle.
NASA NeoWs close-approach data is pulled every hour into Cloudflare D1 and served by a Worker;
a Durable Object runs the shared watch room (who's watching, emoji reactions).
Optionally, Jev (TypeSafe AI) decides how each new pass is featured (`USE_JEV` in `wrangler.jsonc`).

## Quick start

```bash
npm install
npx wrangler d1 create asteroids          # paste the database_id into wrangler.jsonc
npm run db:init:local && npm run db:init
npx wrangler secret put NASA_API_KEY
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put TYPESAFE_API_KEY  # only if USE_JEV is "true"
npm run deploy
```

## Local development

1. Copy `.dev.vars.example` to `.dev.vars` and fill in your keys.
2. Create the local database tables: `npm run db:init:local`
3. Start the dev server: `npm run dev`
4. In a second terminal, run the ingest once to load asteroids:

```bash
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
```

## Refresh the deployed site on demand

The hourly schedule keeps it up to date, but you can trigger an ingest yourself:

```bash
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" https://<your-worker>.workers.dev/api/refresh
```

## Files

| Path | What it does |
| --- | --- |
| `src/neows.ts` | NASA fetch + normalization |
| `src/jev.ts` | Jev questions and the decision rule (the threshold lives in `wrangler.jsonc`) |
| `src/room.ts` | Durable Object: WebSocket room, presence, reactions |
| `src/index.ts` | Routes, hourly ingest, admin review queue |
| `public/` | The watch room page (three.js 3D view + list) |
