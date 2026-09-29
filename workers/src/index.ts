import type { RunContext, Worker, Output } from "../../contracts/index.ts";
const generated = (
  type: string,
  kind: "image" | "video" | "audio" | "image-edit",
  port: string,
): Worker => ({
  type,
  version: 1,
  async run(ctx) {
    const count = type === "image.generate" ? Number(ctx.params.count ?? 1) : 1;
    const outputs: Output[] = [];
    for (let i = 0; i < count; i++) {
      const result = await ctx.models.generate(kind, {
        params: ctx.params,
        inputs: ctx.inputs,
        signal: ctx.signal,
      });
      outputs.push(await ctx.putAsset(result.file, result.meta));
      ctx.report((i + 1) / count);
    }
    return { [port]: type === "image.generate" ? outputs : outputs[0] };
  },
});
export const workers: Worker[] = [
  generated("image.generate", "image", "image"),
  generated("image.edit", "image-edit", "image"),
  generated("video.generate", "video", "video"),
  generated("audio.generate", "audio", "audio"),
];
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
