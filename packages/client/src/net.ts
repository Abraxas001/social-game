import type { ClientMsg, ServerMsg } from "@sg/shared";

export function serverUrl(): string {
  const env = import.meta.env.VITE_WS_URL as string | undefined;
  if (env) return env;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.hostname}:3001`;
}

export class Net {
  private ws: WebSocket | null = null;
  onMessage: (msg: ServerMsg) => void = () => {};
  onClose: () => void = () => {};

  connect(url = serverUrl()): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Could not reach the game server."));
      ws.onclose = () => this.onClose();
      ws.onmessage = (ev) => {
        try {
          this.onMessage(JSON.parse(ev.data as string) as ServerMsg);
        } catch {
          /* ignore malformed frames */
        }
      };
    });
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws?.close();
  }
}
