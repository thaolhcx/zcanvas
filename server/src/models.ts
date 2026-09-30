import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout } from "node:timers/promises";
import sharp from "sharp";
import type { Asset, ModelsClient, RunContext } from "../../contracts/index.ts";
import { config } from "./config.ts";
import { db } from "./db.ts";
import { assetBytes } from "./assets.ts";
const exec = promisify(execFile);
export function createModels(ctx: {
  runId: string;
  jobId: string;
  nodeId: string;
}): ModelsClient {
  return {
    async generate(kind, { params, signal }) {
      if (!config.mock)
        throw new Error(
          "Real model providers are not configured. Use MOCK_WORKERS=1.",
        );
      await setTimeout(Number(process.env.MOCK_DELAY_MS ?? 200), undefined, {
        signal,
      });
      const fileName =
        kind === "video"
          ? "clip.mp4"
          : kind === "audio"
            ? "voice.wav"
            : "portrait.png";
      let bytes: Buffer = await readFile(
        new URL(`../../fixtures/${fileName}`, import.meta.url),
      );
      if (kind === "image-edit" && params.mode === "upscale")
        bytes = await sharp(bytes)
          .resize({ width: 720 * Number(params.scale ?? 2) })
          .png()
          .toBuffer();
      const credits =
        kind === "video"
          ? 2 * Number(params.durationSec ?? 5)
          : kind === "audio"
            ? 0.5
            : 1;
      await db.query(
        "INSERT INTO usage(run_id,job_id,node_id,credits,model) VALUES($1,$2,$3,$4,$5)",
        [ctx.runId, ctx.jobId, ctx.nodeId, credits, `mock:${kind}`],
      );
      return {
        file: new Blob([new Uint8Array(bytes)], {
          type:
            kind === "video"
              ? "video/mp4"
              : kind === "audio"
                ? "audio/wav"
                : "image/png",
        }),
        meta: { kind: kind === "image-edit" ? "image" : kind },
        credits,
      };
    },
  };
}
export async function exportMedia(ctx: RunContext) {
  const video = ctx.inputs.video as Asset;
  const audio = ctx.inputs.audio as Asset | undefined;
  const dir = await mkdtemp(join(tmpdir(), "zcanvas-export-"));
  try {
    await writeFile(join(dir, "video.mp4"), await assetBytes(video.id));
    const args = [
      "-loglevel",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      join(dir, "video.mp4"),
    ];
    if (audio) {
      await writeFile(join(dir, "audio.wav"), await assetBytes(audio.id));
      args.push(
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        join(dir, "audio.wav"),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
      );
    }
    const format = ctx.params.format === "webm" ? "webm" : "mp4";
    const path = join(dir, `out.${format}`);
    args.push(
      "-c:v",
      format === "mp4" ? "copy" : "libvpx-vp9",
      "-c:a",
      format === "mp4" ? "aac" : "libopus",
    );
    if (format === "mp4") args.push("-movflags", "+faststart");
    args.push(path);
    await exec("ffmpeg", args, { signal: ctx.signal });
    return await ctx.putAsset(
      new Blob([new Uint8Array(await readFile(path))], {
        type: `video/${format}`,
      }),
      { kind: "video", meta: { name: ctx.params.name } },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
