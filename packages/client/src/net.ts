import type { ClientMsg, ServerMsg } from "@sg/shared";

export function serverUrl(): string {
  const env = (import.meta.env.VITE_WS_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/+$/, "");
  // On a deployed https site there is no sensible default: the server lives on
  // another host, so say so instead of waiting on a URL that can never answer.
  if (location.protocol === "https:") {
    throw new Error(
      "The game server address is not set. In Vercel, add VITE_WS_URL (for example wss://your-server.onrender.com) and redeploy.",
    );
  }
  return `ws://${location.hostname}:3001`;
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
        // A 4xx means we reached a server that is not ours (wrong address),
        // so waiting will not help. 5xx is what a waking host answers with.
        if (res.status >= 400 && res.status < 500) {
          throw new Error(
            `Reached ${base} but /health returned ${res.status}. Check that VITE_WS_URL points at the game server.`,
          );
        }
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof Error && e.message.startsWith("Reached ")) throw e;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Could not reach ${base} after 90 seconds. Check that the server is deployed and that VITE_WS_URL is correct.`,
        );
      }
      if (!waking) {
        waking = true;
        onStatus?.(`Waking up the free server at ${new URL(base).host}... this can take about a minute.`);
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
