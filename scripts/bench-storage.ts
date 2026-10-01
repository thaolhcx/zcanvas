/**
 * 100 MB upload / download / seek through the real HTTP routes, measuring
 * the API process's peak memory. curl runs in a separate process so client
 * buffers are not counted.
 *
 *   pnpm bench:storage                       # local adapter
 *   STORAGE_DRIVER=s3 S3_AUTO_CREATE_BUCKET=1 pnpm bench:storage   # MinIO/S3
 *
 * Writes docs/evidence/storage-bench-<driver>.json.
 */
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir, cpus, totalmem } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { migrate, db } from "../server/src/db.ts";
import { checkStorage, writeStore } from "../server/src/storage.ts";
import { startQueue, boss } from "../server/src/queue.ts";
import { createApp } from "../server/src/app.ts";
import { config } from "../server/src/config.ts";
const exec = promisify(execFile);
await migrate();
await checkStorage();
await startQueue();
const app = await createApp();
const base = await app.listen({ host: "127.0.0.1", port: 0 });
const dir = await mkdtemp(join(tmpdir(), "zcanvas-bench-"));
const fixture = join(dir, "fixture-100mb.wav");
// ~99 MiB of 16-bit stereo PCM noise: a real, probe-able media file.
await exec("ffmpeg", [
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "anoisesrc=d=590:r=44100:a=0.3",
  "-ac",
  "2",
  "-c:a",
  "pcm_s16le",
  fixture,
]);
const size = (await stat(fixture)).size;
let peak = 0;
const sample = () => (peak = Math.max(peak, process.memoryUsage().rss));
const timer = setInterval(sample, 5);
async function phase<T>(label: string, fn: () => Promise<T>) {
  global.gc?.();
  await new Promise((r) => setTimeout(r, 200));
  const before = process.memoryUsage().rss;
  peak = before;
  const started = performance.now();
  const value = await fn();
  const ms = performance.now() - started;
  sample();
  return {
    label,
    ms: Number(ms.toFixed(1)),
    rssBeforeMb: Number((before / 2 ** 20).toFixed(1)),
    rssPeakMb: Number((peak / 2 ** 20).toFixed(1)),
    rssDeltaMb: Number(((peak - before) / 2 ** 20).toFixed(1)),
    value,
  };
}
const curl = (args: string[]) =>
  exec("curl", ["-sS", "--noproxy", "127.0.0.1", ...args], {
    maxBuffer: 1024 * 1024 * 4,
    encoding: "buffer",
  });
const uploaded = await phase(
  "upload 100 MB (multipart, streamed to temp file, then store)",
  async () => {
    const { stdout } = await curl([
      "-F",
      `file=@${fixture};type=audio/wav`,
      `${base}/assets`,
    ]);
    return JSON.parse(stdout.toString()) as { id: string; bytes: number };
  },
);
const id = uploaded.value.id;
const download = await phase("download full file", async () => {
  const { stdout } = await curl([
    "-o",
    "/dev/null",
    "-w",
    "%{http_code} %{size_download}",
    `${base}/assets/${id}/file`,
  ]);
  return stdout.toString();
});
const seeks = [];
for (const offset of [0, Math.floor(size / 2), size - 1024 * 1024]) {
  seeks.push(
    await phase(`range 1 MiB at ${offset}`, async () => {
      const { stdout } = await curl([
        "-o",
        "/dev/null",
        "-r",
        `${offset}-${offset + 1024 * 1024 - 1}`,
        "-w",
        "%{http_code} %{size_download} %{time_starttransfer}",
        `${base}/assets/${id}/file`,
      ]);
      return stdout.toString();
    }),
  );
}
const suffix = await phase("suffix range bytes=-65536", async () => {
  const { stdout } = await curl([
    "-o",
    "/dev/null",
    "-H",
    "Range: bytes=-65536",
    "-w",
    "%{http_code} %{size_download}",
    `${base}/assets/${id}/file`,
  ]);
  return stdout.toString();
});
const aborted = await phase(
  "client aborts after 1 MiB of a full download",
  async () => {
    await curl([
      "-o",
      "/dev/null",
      "--max-time",
      "5",
      "-r",
      "0-",
      "--limit-rate",
      "2M",
      "-m",
      "0.5",
      `${base}/assets/${id}/file`,
    ]).catch(() => "aborted");
    return "aborted";
  },
);
clearInterval(timer);
const report = {
  generatedAt: new Date().toISOString(),
  driver: writeStore().driver,
  profile: writeStore().profile,
  fileBytes: size,
  maxUploadBytes: config.storage.maxUploadBytes,
  machine: {
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    node: process.version,
    note: "Cloud container; API, Postgres and storage on one host.",
  },
  note: "rssDeltaMb is the API process's peak RSS increase during the phase. A full-buffering route would add at least the file size (~100 MB).",
  phases: [uploaded, download, ...seeks, suffix, aborted].map(
    ({ value, ...rest }) => ({
      ...rest,
      result:
        typeof value === "string"
          ? value
          : { id: value.id, bytes: value.bytes },
    }),
  ),
};
const path = new URL(
  `../docs/evidence/storage-bench-${report.driver}.json`,
  import.meta.url,
);
await writeFile(path, JSON.stringify(report, null, 1) + "\n");
for (const p of report.phases)
  console.log(
    `${p.label}: ${p.ms} ms, peak RSS +${p.rssDeltaMb} MB (${p.result && typeof p.result === "string" ? p.result : ""})`,
  );
await app.inject({ method: "DELETE", url: `/assets/${id}` });
await rm(dir, { recursive: true, force: true });
await app.close();
await boss.stop({ graceful: false });
await db.end();
