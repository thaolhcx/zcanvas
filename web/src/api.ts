import type { Run } from "../../contracts/index.ts";
export const API = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4310";
export const SYNC = import.meta.env.VITE_SYNC_URL ?? "ws://127.0.0.1:4311";
export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(API + path, {
    ...options,
    // JSON bodies only: Fastify rejects an empty body declared as JSON (DELETE).
    headers:
      options?.body === undefined || options.body instanceof FormData
        ? options?.headers
        : { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) throw await problem(response);
  return response.json();
}
/** A failed API call. `message` stays the server's readable text. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}
async function problem(response: Response) {
  const body = await response.json().catch(() => ({}));
  return new ApiRequestError(
    Array.isArray(body)
      ? body.map((i) => i.message).join("; ")
      : (body.error ?? `Request failed (${response.status})`),
    response.status,
    Array.isArray(body) ? body[0]?.code : body.code,
    body,
  );
}
export const statusOf = (error: unknown) =>
  error instanceof ApiRequestError ? error.status : undefined;
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
