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

  /**
   * Free hosts put idle servers to sleep, so first poll /health until the
   * server answers (up to ~90 s), then open the WebSocket.
   */
  private async wake(url: string, onStatus?: (text: string) => void): Promise<void> {
    const base = url.replace(/^ws/, "http");
    const deadline = Date.now() + 90_000;
    let waking = false;
    for (;;) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(`${base}/health`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (res.ok) return;
      } catch {
        clearTimeout(timer);
      }
      if (Date.now() > deadline) {
        throw new Error("The server is still waking up. Please try again in a minute.");
      }
      if (!waking) {
        waking = true;
        onStatus?.("Waking up the free server... this can take about a minute.");
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
  }

  async connect(url = serverUrl(), onStatus?: (text: string) => void): Promise<void> {
    await this.wake(url, onStatus);
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
