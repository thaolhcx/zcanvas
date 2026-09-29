import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type { Asset } from "../../contracts/index.ts";
import { db } from "./db.ts";
import { config } from "./config.ts";
const exec = promisify(execFile);
export const s3 = new S3Client({
  endpoint: config.s3Endpoint,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.s3AccessKey,
    secretAccessKey: config.s3SecretKey,
  },
});
export async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.s3Bucket }));
  } catch (error) {
    if (
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode !== 404
    )
      throw error;
    await s3.send(new CreateBucketCommand({ Bucket: config.s3Bucket }));
  }
}
export async function getAsset(id: string): Promise<Asset> {
  const { rows } = await db.query("SELECT data FROM assets WHERE id=$1", [id]);
  if (!rows.length) throw new Error(`Asset ${id} not found`);
  return rows[0].data;
}
export async function assetBytes(id: string) {
  const out = await s3.send(
    new GetObjectCommand({ Bucket: config.s3Bucket, Key: id }),
  );
  return Buffer.from(await out.Body!.transformToByteArray());
}
export async function putAsset(
  file: Blob | ReadableStream,
  metadata: Partial<Asset>,
): Promise<Asset> {
  const blob = file instanceof Blob ? file : await new Response(file).blob();
  const buffer = Buffer.from(await blob.arrayBuffer());
  const mime = metadata.mime ?? blob.type;
  const kind = metadata.kind ?? mime.split("/")[0];
  if (!["image", "video", "audio"].includes(kind))
    throw new Error("Only image, video and audio assets are supported");
  let thumb: Buffer | undefined;
  let measured: Asset["meta"] = {};
  if (kind === "image") {
    const info = await sharp(buffer).metadata();
    measured = { width: info.width, height: info.height };
    thumb = await sharp(buffer)
      .resize({
        width: 300,
        height: 300,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg()
      .toBuffer();
  } else {
    const dir = await mkdtemp(join(tmpdir(), "zcanvas-probe-"));
    try {
      const path = join(dir, "media");
      await writeFile(path, buffer);
      const result = await exec("ffprobe", [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        path,
      ]);
      const info = JSON.parse(result.stdout);
      const video = info.streams.find(
        (s: { codec_type: string }) => s.codec_type === "video",
      );
      measured = {
        durationSec: Number(info.format.duration),
        ...(video ? { width: video.width, height: video.height } : {}),
      };
      if (kind === "video") {
        await exec("ffmpeg", [
          "-loglevel",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          path,
          "-frames:v",
          "1",
          "-vf",
          "scale=300:-1",
          join(dir, "poster.jpg"),
        ]);
        thumb = await readFile(join(dir, "poster.jpg"));
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const id = `ast_${crypto.randomUUID()}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3Bucket,
      Key: id,
      Body: buffer,
      ContentType: mime,
    }),
  );
  if (thumb)
    await s3.send(
      new PutObjectCommand({
        Bucket: config.s3Bucket,
        Key: `${id}_thumb`,
        Body: thumb,
        ContentType: "image/jpeg",
      }),
    );
  const asset: Asset = {
    id,
    kind: kind as Asset["kind"],
    mime,
    bytes: buffer.length,
    url: `${config.publicUrl}/assets/${id}/file`,
    ...(thumb
      ? { thumbUrl: `${config.publicUrl}/assets/${id}/thumbnail` }
      : {}),
    meta: { ...metadata.meta, ...measured },
    ...(metadata.createdBy ? { createdBy: metadata.createdBy } : {}),
    createdAt: new Date().toISOString(),
  };
  await db.query("INSERT INTO assets(id,data) VALUES($1,$2)", [id, asset]);
  return asset;
}
