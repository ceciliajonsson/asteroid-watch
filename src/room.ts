// One Durable Object per watch room. Uses WebSocket hibernation so idle rooms cost nothing.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

const EMOJI = ["☄️", "🔭", "😮"] as const;
const ID_RE = /^\d{1,12}$/;

type Attachment = { lastReactAt: number };

export class WatchRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ lastReactAt: 0 } satisfies Attachment);

    server.send(JSON.stringify({ type: "hello", reactions: await this.allReactions() }));
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > 512) return;
    let msg: any;
    try { msg = JSON.parse(message); } catch { return; }
    if (msg?.type !== "react" || !ID_RE.test(msg.id) || !EMOJI.includes(msg.emoji)) return;

    // Simple per-connection throttle: one reaction every 500 ms.
    const att = ws.deserializeAttachment() as Attachment;
    const now = Date.now();
    if (now - att.lastReactAt < 500) return;
    ws.serializeAttachment({ lastReactAt: now } satisfies Attachment);

    const key = `r:${msg.id}:${msg.emoji}`;
    const count = ((await this.ctx.storage.get<number>(key)) ?? 0) + 1;
    await this.ctx.storage.put(key, count);
    this.broadcast({ type: "react", id: msg.id, emoji: msg.emoji, count });
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code, "bye"); } catch {}
    this.broadcastPresence(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.broadcastPresence(ws);
  }

  // Called over RPC by the Worker after each ingest run.
  async notifyRefresh(newCount: number) {
    this.broadcast({ type: "refresh", newCount });
  }

  private async allReactions() {
    const out: Record<string, Record<string, number>> = {};
    for (const [key, n] of await this.ctx.storage.list<number>({ prefix: "r:" })) {
      const [, id, emoji] = key.split(":");
      (out[id] ??= {})[emoji] = n;
    }
    return out;
  }

  private broadcastPresence(leaving?: WebSocket) {
    const viewers = this.ctx.getWebSockets().filter((s) => s !== leaving).length;
    this.broadcast({ type: "presence", viewers }, leaving);
  }

  private broadcast(obj: unknown, skip?: WebSocket) {
    const data = JSON.stringify(obj);
    for (const s of this.ctx.getWebSockets()) {
      if (s === skip) continue;
      try { s.send(data); } catch {}
    }
  }
}
