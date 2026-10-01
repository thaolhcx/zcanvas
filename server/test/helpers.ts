import { readFile } from "node:fs/promises";
import type { createApp } from "../src/app.ts";
import { db } from "../src/db.ts";
import { ensureActor } from "../src/access.ts";
export type App = Awaited<ReturnType<typeof createApp>>;
export const fixture = (name: string) =>
  readFile(new URL(`../../fixtures/${name}`, import.meta.url));
export function multipart(
  file: { name: string; type: string; data: Buffer },
  fields: Record<string, string> = {},
) {
  const boundary = `----zcanvas${crypto.randomUUID()}`;
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields))
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
      ),
    );
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    payload: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}
export async function upload(
  app: App,
  file: { name: string; type: string; data: Buffer },
  query = "",
  fields: Record<string, string> = {},
) {
  const body = multipart(file, fields);
  return app.inject({ method: "POST", url: `/assets${query}`, ...body });
}
export const png = async (name = "portrait.png") => ({
  name,
  type: "image/png",
  data: await fixture("portrait.png"),
});
export async function newCanvas(app: App, body: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/canvases",
    payload: { name: "Asset test", ...body },
  });
  if (response.statusCode !== 200) throw new Error(response.body);
  return response.json<{ canvasId: string; spaceId: string }>();
}
/** A team space with explicit members; team admin UI is out of scope. */
export async function teamSpace(
  members: Record<string, "owner" | "editor" | "viewer">,
) {
  const id = `spc_team_${crypto.randomUUID().slice(0, 8)}`;
  await db.query("INSERT INTO spaces(id,kind,name) VALUES($1,'team',$2)", [
    id,
    `Team ${id.slice(-4)}`,
  ]);
  for (const [user, role] of Object.entries(members)) {
    await ensureActor(user);
    await db.query(
      "INSERT INTO space_members(space_id,user_id,role) VALUES($1,$2,$3)",
      [id, user, role],
    );
  }
  return id;
}
export async function until<T>(
  fn: () => Promise<T | undefined | false>,
  ms = 15000,
) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error("Timed out");
    await new Promise((r) => setTimeout(r, 75));
  }
}
