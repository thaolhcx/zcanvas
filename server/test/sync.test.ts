import { it, expect } from "vitest";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Graph, Y, emptyRecipe, readRecipe } from "../../graph/src/index.ts";
import { createSyncServer } from "../src/sync.ts";
import { db, migrate } from "../src/db.ts";
import { registry } from "../src/registry.ts";
import { personalSpaceId } from "../src/access.ts";
import { config } from "../src/config.ts";
const until = async (fn: () => boolean | Promise<boolean>) => {
  const end = Date.now() + 8000;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error("Sync timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
};
it("two headless clients edit offline and converge with persisted server document", async () => {
  await migrate();
  const initial = emptyRecipe();
  const seed = new Graph(new Y.Doc(), registry, initial);
  await db.query(
    "INSERT INTO canvases(id,name,ydoc,space_id) VALUES($1,$2,$3,$4)",
    [
      initial.meta.id,
      initial.meta.name,
      Buffer.from(Y.encodeStateAsUpdate(seed.doc)),
      personalSpaceId(config.actorId),
    ],
  );
  const server = createSyncServer(0);
  await server.listen();
  const docs = [new Y.Doc(), new Y.Doc()];
  const providers = docs.map(
    (document) =>
      new HocuspocusProvider({
        url: server.webSocketURL,
        name: initial.meta.id,
        document,
      }),
  );
  try {
    await until(() => providers.every((p) => p.synced));
    const a = new Graph(docs[0], registry),
      b = new Graph(docs[1], registry);
    providers[1].disconnect();
    await new Promise((r) => setTimeout(r, 100));
    const first = a.addNode("input.prompt", {
      params: { text: "Online edit" },
    });
    const second = b.addNode("input.prompt", {
      params: { text: "Offline edit" },
    });
    providers[1].connect();
    await until(
      () => a.toRecipe().nodes.length === 2 && b.toRecipe().nodes.length === 2,
    );
    expect(
      a
        .toRecipe()
        .nodes.map((n) => n.id)
        .sort(),
    ).toEqual([first, second].sort());
    await until(async () => {
      const { rows } = await db.query("SELECT ydoc FROM canvases WHERE id=$1", [
        initial.meta.id,
      ]);
      const d = new Y.Doc();
      Y.applyUpdate(d, rows[0].ydoc);
      return readRecipe(d).nodes.length === 2;
    });
    expect(a.toRecipe()).toEqual(b.toRecipe());
    a.destroy();
    b.destroy();
  } finally {
    providers.forEach((p) => p.destroy());
    await server.destroy();
    await db.query("DELETE FROM canvases WHERE id=$1", [initial.meta.id]);
  }
}, 20000);
