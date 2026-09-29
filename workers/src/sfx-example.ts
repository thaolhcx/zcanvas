import type { Worker } from "../../contracts/index.ts";
/** Optional ninth node: the same registry-driven canvas requires no changes. */
export const sfxWorker: Worker = {
  type: "audio.sfx",
  version: 1,
  async run(ctx) {
    const result = await ctx.models.generate("audio", {
      params: ctx.params,
      inputs: ctx.inputs,
      signal: ctx.signal,
    });
    return { audio: await ctx.putAsset(result.file, result.meta) };
  },
};
