import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  LocalStore,
  S3Store,
  StorageError,
  newKey,
  type ObjectStore,
} from "../src/storage.ts";
import { contentDisposition, parseRange } from "../src/media.ts";
const text = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
};
/** The same contract runs against every adapter. */
function contract(name: string, make: () => Promise<ObjectStore>) {
  describe(`${name} storage contract`, () => {
    let store: ObjectStore;
    beforeAll(async () => {
      store = await make();
      await store.check();
    });
    it("writes, stats, reads, reads ranges and deletes", async () => {
      const key = newKey();
      const body = "0123456789abcdef";
      await store.put(key, Readable.from(Buffer.from(body)), {
        bytes: body.length,
        contentType: "text/plain",
      });
      expect((await store.stat(key))?.bytes).toBe(16);
      expect(await text(await store.read(key))).toBe(body);
      expect(await text(await store.read(key, { range: { start: 2, end: 5 } }))).toBe("2345");
      expect(await text(await store.read(key, { range: { start: 10, end: 15 } }))).toBe("abcdef");
      await store.delete(key);
      await store.delete(key); // idempotent
      expect(await store.stat(key)).toBeUndefined();
      await expect(store.read(key)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
    it("leaves no object when the body is shorter or longer than declared", async () => {
      const short = newKey();
      await expect(
        store.put(short, Readable.from(Buffer.from("abc")), { bytes: 10, contentType: "text/plain" }),
      ).rejects.toBeTruthy();
      expect(await store.stat(short)).toBeUndefined();
      const long = newKey();
      await expect(
        store.put(long, Readable.from(Buffer.from("abcdef")), { bytes: 2, contentType: "text/plain" }),
      ).rejects.toBeTruthy();
      expect(await store.stat(long)).toBeUndefined();
    });
    it("leaves no object when the source stream fails mid-write", async () => {
      const key = newKey();
      const source = new Readable({
        read() {
          this.push(Buffer.alloc(1024, 1));
          this.destroy(new Error("client went away"));
        },
      });
      await expect(
        store.put(key, source, { bytes: 4096, contentType: "application/octet-stream" }),
      ).rejects.toBeTruthy();
      expect(await store.stat(key)).toBeUndefined();
    });
    it("rejects keys that are not server-generated", async () => {
      for (const key of ["../escape", "a/../../b", "/etc/passwd", "A/Upper", "a//b", "", "x\u0000"])
        await expect(store.stat(key)).rejects.toBeInstanceOf(StorageError);
    });
  });
}
let root: string;
contract("local", async () => {
  root = await mkdtemp(join(tmpdir(), "zcanvas-store-"));
  return new LocalStore({ id: "test-local", driver: "local", root });
});
// MinIO / S3-compatible target. Set S3_TEST_ENDPOINT (and optionally
// S3_TEST_BUCKET, S3_TEST_ACCESS_KEY, S3_TEST_SECRET_KEY) to run it.
const s3 = process.env.S3_TEST_ENDPOINT;
(s3 ? contract : describe.skip)("s3", async () =>
  new S3Store(
    {
      id: "test-s3",
      driver: "s3",
      endpoint: s3,
      bucket: process.env.S3_TEST_BUCKET ?? "zcanvas-test",
      region: "us-east-1",
      accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? "zcanvas",
      secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? "zcanvas-local-only",
      forcePathStyle: true,
      prefix: `contract-${Date.now()}`,
    },
    true,
  ),
);
describe("local adapter confinement", () => {
  let base: string, store: LocalStore;
  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "zcanvas-escape-"));
    await mkdir(join(base, "root"));
    await mkdir(join(base, "outside"));
    await writeFile(join(base, "outside", "secret"), "secret");
    store = new LocalStore({ id: "escape", driver: "local", root: join(base, "root") });
  });
  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
    if (root) await rm(root, { recursive: true, force: true });
  });
  it("refuses to read through a symlinked file or directory", async () => {
    await symlink(join(base, "outside", "secret"), join(base, "root", "linked"));
    await expect(store.read("linked")).rejects.toMatchObject({ code: "INVALID_KEY" });
    await symlink(join(base, "outside"), join(base, "root", "dir"));
    await expect(store.read("dir/secret")).rejects.toMatchObject({ code: "INVALID_KEY" });
    await expect(store.stat("dir/secret")).rejects.toMatchObject({ code: "INVALID_KEY" });
    await expect(
      store.put("dir/new", Readable.from(Buffer.from("x")), { bytes: 1, contentType: "text/plain" }),
    ).rejects.toMatchObject({ code: "INVALID_KEY" });
    expect(await readdir(join(base, "outside"))).toEqual(["secret"]);
  });
});
describe("byte ranges", () => {
  it("parses full, open-ended and suffix ranges", () => {
    expect(parseRange(undefined, 100)).toEqual({ type: "full" });
    expect(parseRange("bytes=0-9", 100)).toEqual({ type: "partial", range: { start: 0, end: 9 } });
    expect(parseRange("bytes=90-", 100)).toEqual({ type: "partial", range: { start: 90, end: 99 } });
    expect(parseRange("bytes=-10", 100)).toEqual({ type: "partial", range: { start: 90, end: 99 } });
    expect(parseRange("bytes=-500", 100)).toEqual({ type: "partial", range: { start: 0, end: 99 } });
    expect(parseRange("bytes=50-5000", 100)).toEqual({ type: "partial", range: { start: 50, end: 99 } });
  });
  it("rejects ranges outside the file and ignores unsupported forms", () => {
    for (const header of ["bytes=100-", "bytes=200-300", "bytes=-0", "bytes=9-3", "bytes=-"])
      expect(parseRange(header, 100)).toEqual({ type: "unsatisfiable" });
    expect(parseRange("bytes=0-1", 0)).toEqual({ type: "unsatisfiable" });
    expect(parseRange("items=0-1", 100)).toEqual({ type: "full" });
    expect(parseRange("bytes=0-1,5-6", 100)).toEqual({ type: "full" });
  });
  it("builds safe download names", () => {
    expect(contentDisposition('a"b/c\\d.png', true)).toBe(
      `attachment; filename="a_b_c_d.png"; filename*=UTF-8''a_b_c_d.png`,
    );
    expect(contentDisposition("ảnh mèo.png", false)).toBe(
      `inline; filename="_nh m_o.png"; filename*=UTF-8''%E1%BA%A3nh%20m%C3%A8o.png`,
    );
  });
});
