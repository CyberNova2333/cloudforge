// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { DurableObject } from 'cloudflare:workers';

/** Hibernating hub for every live WebSocket; relays "changed" pings by channel tag. */
export class LiveHub extends DurableObject<CloudflareBindings> {
  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    // Keepalives are answered without waking the object.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong')
    );
  }

  /** Accepts a socket the worker already authenticated, subscribed to `X-Live-Channels`. */
  async fetch(request: Request): Promise<Response> {
    const channels = (request.headers.get('X-Live-Channels') ?? '')
      .split(',')
      .filter(Boolean);
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], channels);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** Sends a ping to every socket subscribed to `channel`. */
  async publish(channel: string, message: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(channel)) {
      try {
        ws.send(message);
      } catch {
        // Closing; the browser reconnects.
      }
    }
  }

  /** `publish` for several channels in one call (a notification's recipients). */
  async publishMany(channels: string[], message: string): Promise<void> {
    for (const channel of channels) await this.publish(channel, message);
  }

  async webSocketMessage() {}

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code, 'closing');
    } catch {
      // Already closed.
    }
  }
}
