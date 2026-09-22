import type { Env } from "./env";
import { fetchFeed, type Asteroid } from "./neows";
import { askJev, decide } from "./jev";

export { WatchRoom } from "./room";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// Run async work over a list with limited concurrency (be polite to the Jev API).
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

// Fields that come straight from NASA. These are refreshed on every ingest, so corrections to
// distance, size, speed or NASA's hazardous / Sentry labels show up. Our own decision
// (status, Jev's rating) is left alone.
const NASA_FIELDS = [
  "name", "approach_at", "approach_epoch", "diameter_min_m", "diameter_max_m", "velocity_kps",
  "miss_ld", "miss_km", "hazardous", "sentry", "magnitude", "jpl_url",
] as const;
const nasaValues = (a: Asteroid) => [
  a.name, a.approachAt, a.approachEpoch, a.diameterMinM, a.diameterMaxM, a.velocityKps,
  a.missLd, a.missKm, a.hazardous ? 1 : 0, a.sentry ? 1 : 0, a.magnitude, a.jplUrl,
];

async function ingest(env: Env): Promise<{ fetched: number; decided: number; updated: number }> {
  // NeoWs allows at most 7 days per request. Yesterday → +5 days keeps well over 20 passes around "now".
  const DAY = 86_400_000;
  const now0 = Date.now();
  const asteroids = await fetchFeed(env.NASA_API_KEY, isoDate(new Date(now0 - DAY)), isoDate(new Date(now0 + 5 * DAY)));
  if (asteroids.length === 0) return { fetched: 0, decided: 0, updated: 0 };

  // Which ones do we already have? D1 allows 100 bound parameters per query, so chunk.
  const ids = asteroids.map((a) => a.id);
  const seenIds = new Set<string>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const seen = await env.DB.prepare(
      `SELECT id FROM asteroids WHERE id IN (${chunk.map(() => "?").join(",")})`,
    ).bind(...chunk).all<{ id: string }>();
    for (const r of seen.results) seenIds.add(r.id);
  }
  const fresh = asteroids.filter((a) => !seenIds.has(a.id));
  const known = asteroids.filter((a) => seenIds.has(a.id));

  // Only new objects get a decision (and a Jev call when it's on).
  const threshold = Number(env.AUTO_FEATURE_CONFIDENCE ?? "0.8");
  const useJev = env.USE_JEV === "true";
  const decided = await mapLimit(fresh, 6, async (a) => {
    if (!useJev) return { a, ans: null, status: "listed" as const }; // Jev off: show everything as-is
    try {
      const ans = await askJev(env.TYPESAFE_API_KEY, a);
      return { a, ans, status: decide(ans, threshold) };
    } catch (err) {
      console.error(`Jev failed for ${a.id}`, err);
      return { a, ans: null, status: "review" as const }; // fail safe: a human decides
    }
  });

  const now = new Date().toISOString();
  const insert = env.DB.prepare(
    `INSERT OR REPLACE INTO asteroids
     (id, ${NASA_FIELDS.join(", ")}, tier, tier_confidence, wow_score, needs_context, status, decided_at, raw_decision)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  // Update known rows only when NASA's data actually differs, so the change count is meaningful.
  const update = env.DB.prepare(
    `UPDATE asteroids SET ${NASA_FIELDS.map((f) => `${f} = ?`).join(", ")}
     WHERE id = ? AND NOT (${NASA_FIELDS.map((f) => `${f} IS ?`).join(" AND ")})`,
  );
  const results = await env.DB.batch([
    ...decided.map(({ a, ans, status }) =>
      insert.bind(
        a.id, ...nasaValues(a),
        ans?.tier.choice ?? null, ans?.tier.confidence ?? null, ans?.wow.score ?? null,
        ans?.needs_context.noul ?? null, status, now, ans ? JSON.stringify(ans) : null,
      ),
    ),
    ...known.map((a) => update.bind(...nasaValues(a), a.id, ...nasaValues(a))),
  ]);
  const updated = results.slice(decided.length).reduce((n, r) => n + (r.meta.changes ?? 0), 0);

  // Tell open pages to reload, but only when something actually changed.
  if (fresh.length > 0 || updated > 0) {
    const room = env.WATCH_ROOM.get(env.WATCH_ROOM.idFromName("global"));
    await room.notifyRefresh(fresh.length);
  }

  return { fetched: asteroids.length, decided: fresh.length, updated };
}

function isAdmin(req: Request, env: Env) {
  return Boolean(env.ADMIN_TOKEN) && req.headers.get("x-admin-token") === env.ADMIN_TOKEN;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);

    // WebSocket rooms: /room/<name>
    if (parts[0] === "room" && parts[1]) {
      const name = parts[1].slice(0, 64);
      const stub = env.WATCH_ROOM.get(env.WATCH_ROOM.idFromName(name));
      return stub.fetch(req);
    }

    // Public: the 20 closest current approaches (review items are hidden until a human approves them)
    if (req.method === "GET" && url.pathname === "/api/asteroids") {
      const since = Date.now() - 12 * 3_600_000;
      const rows = await env.DB.prepare(
        `SELECT * FROM asteroids WHERE approach_epoch >= ? AND status != 'review'
         ORDER BY miss_ld ASC LIMIT 20`,
      ).bind(since).all();
      return json(rows.results);
    }

    // Admin: run an ingest now (handy for demos)
    if (req.method === "POST" && url.pathname === "/api/refresh") {
      if (!isAdmin(req, env)) return json({ error: "Forbidden" }, 403);
      return json(await ingest(env));
    }

    // Admin: list and resolve the review queue
    if (url.pathname === "/api/review" && req.method === "GET") {
      if (!isAdmin(req, env)) return json({ error: "Forbidden" }, 403);
      const rows = await env.DB.prepare(
        `SELECT id, name, miss_ld, tier, tier_confidence, wow_score, raw_decision FROM asteroids
         WHERE status = 'review' ORDER BY approach_epoch ASC`,
      ).all();
      return json(rows.results);
    }
    if (req.method === "POST" && parts[0] === "api" && parts[1] === "review" && parts[2]) {
      if (!isAdmin(req, env)) return json({ error: "Forbidden" }, 403);
      const { status } = await req.json<{ status: string }>();
      if (status !== "featured" && status !== "listed") return json({ error: "status must be featured or listed" }, 400);
      await env.DB.prepare(`UPDATE asteroids SET status = ? WHERE id = ?`).bind(status, parts[2]).run();
      const room = env.WATCH_ROOM.get(env.WATCH_ROOM.idFromName("global"));
      ctx.waitUntil(room.notifyRefresh(0));
      return json({ ok: true });
    }

    return env.ASSETS.fetch(req);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(ingest(env).then((r) => console.log("ingest", r)));
  },
} satisfies ExportedHandler<Env>;
