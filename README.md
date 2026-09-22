# Asteroid Watch

NASA NeoWs close-approach data → Jev (TypeSafe AI) decides how each pass is featured →
Cloudflare Workers + D1 + Durable Objects serve a live, shared watch room.

Quick start:
  npm install
  npx wrangler d1 create asteroids        # paste database_id into wrangler.jsonc
  npm run db:init:local && npm run db:init
  npx wrangler secret put NASA_API_KEY
  npx wrangler secret put TYPESAFE_API_KEY
  npx wrangler secret put ADMIN_TOKEN
  npm run deploy

Local dev: copy .dev.vars.example to .dev.vars, then `npm run dev` and trigger the cron with
  curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"

Files:
  src/neows.ts   NASA fetch + normalization
  src/jev.ts     Jev questions and the decision rule (the threshold lives in wrangler.jsonc)
  src/room.ts    Durable Object: WebSocket room, presence, reactions
  src/index.ts   Routes, cron ingest, admin review queue
  public/        The watch room page
