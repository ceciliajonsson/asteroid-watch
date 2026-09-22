// NASA NeoWs (Near Earth Object Web Service): https://api.nasa.gov
export interface Asteroid {
  id: string;
  name: string;
  approachAt: string;      // e.g. "2026-Sep-22 14:05"
  approachEpoch: number;   // ms since epoch
  diameterMinM: number;
  diameterMaxM: number;
  velocityKps: number;
  missLd: number;          // lunar distances (1 LD ≈ 384,400 km)
  missKm: number;
  hazardous: boolean;      // NASA's "potentially hazardous" orbital class, not an impact prediction
  sentry: boolean;         // on JPL's Sentry impact-monitoring list
  magnitude: number;
  jplUrl: string;
}

export async function fetchFeed(apiKey: string, start: string, end: string): Promise<Asteroid[]> {
  const url = new URL("https://api.nasa.gov/neo/rest/v1/feed");
  url.searchParams.set("start_date", start);
  url.searchParams.set("end_date", end);
  url.searchParams.set("api_key", apiKey);

  const res = await fetch(url, { cf: { cacheTtl: 900, cacheEverything: true } });
  if (!res.ok) throw new Error(`NeoWs ${res.status}: ${await res.text()}`);
  const data = await res.json<any>();

  const out: Asteroid[] = [];
  for (const [date, objects] of Object.entries<any[]>(data.near_earth_objects ?? {})) {
    for (const o of objects) {
      const ca =
        o.close_approach_data?.find((c: any) => c.orbiting_body === "Earth" && c.close_approach_date === date) ??
        o.close_approach_data?.[0];
      if (!ca) continue;
      const d = o.estimated_diameter?.meters ?? {};
      out.push({
        id: String(o.id),
        name: String(o.name).replace(/[()]/g, "").trim(),
        approachAt: ca.close_approach_date_full ?? ca.close_approach_date,
        approachEpoch: Number(ca.epoch_date_close_approach),
        diameterMinM: Number(d.estimated_diameter_min ?? 0),
        diameterMaxM: Number(d.estimated_diameter_max ?? 0),
        velocityKps: Number(ca.relative_velocity?.kilometers_per_second ?? 0),
        missLd: Number(ca.miss_distance?.lunar ?? 0),
        missKm: Number(ca.miss_distance?.kilometers ?? 0),
        hazardous: Boolean(o.is_potentially_hazardous_asteroid),
        sentry: Boolean(o.is_sentry_object),
        magnitude: Number(o.absolute_magnitude_h ?? 0),
        jplUrl: String(o.nasa_jpl_url ?? ""),
      });
    }
  }
  return out;
}
