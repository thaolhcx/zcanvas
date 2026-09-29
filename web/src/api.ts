import type { Run } from "../../contracts/index.ts";
export const API = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4310";
export const SYNC = import.meta.env.VITE_SYNC_URL ?? "ws://127.0.0.1:4311";
export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(API + path, {
    ...options,
    headers:
      options?.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      Array.isArray(body)
        ? body.map((i) => i.message).join("; ")
        : (body.error ?? `Request failed (${response.status})`),
    );
  }
  return response.json();
}
export const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
export function followRun(id: string, update: (run: Run) => void) {
  let socket: WebSocket | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    stopped = false,
    after = 0,
    refreshing = false,
    dirty = false;
  const refresh = async () => {
    if (refreshing) {
      dirty = true;
      return;
    }
    refreshing = true;
    try {
      const run = await request<Run>(`/runs/${id}`);
      if (!stopped) update(run);
    } finally {
      refreshing = false;
      if (dirty && !stopped) {
        dirty = false;
        void refresh().catch(() => {});
      }
    }
  };
  const connect = async () => {
    try {
      await refresh();
      if (stopped) return;
      socket = new WebSocket(
        API.replace(/^http/, "ws") + `/runs/${id}/events?after=${after}`,
      );
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        after = Math.max(after, data.eventId ?? 0);
        void refresh().catch(() => {});
      };
      socket.onclose = () => {
        if (!stopped) timer = setTimeout(connect, 1000);
      };
    } catch {
      if (!stopped) timer = setTimeout(connect, 1000);
    }
  };
  void connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    socket?.close();
  };
}
