import { isLocalOrigin } from "./origin.ts";
import { Server } from "@hocuspocus/server";
import * as Y from "yjs";
import { readRecipe } from "../../graph/src/index.ts";
import { db } from "./db.ts";
import { config } from "./config.ts";
export function createSyncServer(port = config.syncPort) {
  return new Server({
    port,
    address: "127.0.0.1",
    quiet: true,
    debounce: 100,
    maxDebounce: 500,
    async onConnect({ requestHeaders }) {
      if (!isLocalOrigin(requestHeaders.get("origin")))
        throw new Error("Only the local workspace may sync");
    },
    async onLoadDocument({ documentName, document }) {
      const { rows } = await db.query("SELECT ydoc FROM canvases WHERE id=$1", [
        documentName,
      ]);
      if (!rows.length) throw new Error("Canvas does not exist");
      if (rows[0].ydoc) Y.applyUpdate(document, rows[0].ydoc);
      return document;
    },
    async onStoreDocument({ documentName, document }) {
      const recipe = readRecipe(document);
      await db.query(
        "UPDATE canvases SET ydoc=$2, snapshot=$3, version=$4, name=$5, updated_at=now() WHERE id=$1",
        [
          documentName,
          Buffer.from(Y.encodeStateAsUpdate(document)),
          recipe,
          recipe.meta.version,
          recipe.meta.name,
        ],
      );
    },
  });
}
