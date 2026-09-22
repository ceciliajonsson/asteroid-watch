import type { WatchRoom } from "./room";

export interface Env {
  DB: D1Database;
  WATCH_ROOM: DurableObjectNamespace<WatchRoom>;
  ASSETS: Fetcher;
  NASA_API_KEY: string;
  TYPESAFE_API_KEY: string;
  ADMIN_TOKEN: string;
  AUTO_FEATURE_CONFIDENCE: string;
  USE_JEV: string;
}
