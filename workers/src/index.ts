import type { RunContext, Worker, Output } from "../../contracts/index.ts";
/**
 * Inline workers: work that is not a model call (export, extensions). Model
 * calls (image/video/audio/text generate, image.edit) never run here: they go
 * through the server's model queue (server/src/gen.ts).
 */
export const workers: Worker[] = [];
export function registerWorker(worker: Worker) {
  if (workers.some((w) => w.type === worker.type))
    throw new Error(`Duplicate worker ${worker.type}`);
  workers.push(worker);
}
export type ExportMedia = (ctx: RunContext) => Promise<Output>;
export const exportWorker = (exportMedia: ExportMedia): Worker => ({
  type: "output.export",
  version: 1,
  async run(ctx) {
    return { file: await exportMedia(ctx) };
  },
});
