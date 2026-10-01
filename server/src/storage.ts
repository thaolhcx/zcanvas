import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { constants, createWriteStream } from "node:fs";
import {
  mkdir,
  open,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { PassThrough, type Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  config,
  type LocalProfileConfig,
  type S3ProfileConfig,
  type StorageProfileConfig,
} from "./config.ts";
export interface StoredObject {
  bytes: number;
  lastModified?: Date;
}
/** Inclusive byte offsets, already validated against the object size. */
export interface ByteRange {
  start: number;
  end: number;
}
/** The small storage contract the catalog needs. Keys are always server-generated. */
export interface ObjectStore {
  readonly profile: string;
  readonly driver: "local" | "s3";
  /** Writes exactly `bytes` bytes or fails without leaving a readable object. */
  put(
    key: string,
    body: Readable,
    options: { bytes: number; contentType: string },
  ): Promise<void>;
  stat(key: string): Promise<StoredObject | undefined>;
  /** Destroying the returned stream releases the upstream read. */
  read(
    key: string,
    options?: { range?: ByteRange; signal?: AbortSignal },
  ): Promise<Readable>;
  /** Idempotent. */
  delete(key: string): Promise<void>;
  /** Checks that the store can be used, without creating anything unless configured. */
  check(): Promise<void>;
}
export class StorageError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "INVALID_KEY"
      | "UNAVAILABLE"
      | "SIZE_MISMATCH",
  ) {
    super(message);
  }
}
const KEY = /^[a-z0-9]+(?:[/_.-][a-z0-9]+)*$/;
export function assertKey(key: string) {
  if (
    typeof key !== "string" ||
    key.length > 200 ||
    !KEY.test(key) ||
    key.split("/").some((part) => part === "." || part === "..")
  )
    throw new StorageError("Invalid storage key", "INVALID_KEY");
}
/** Opaque key; never derived from a file name or client input. */
export function newKey(suffix?: string) {
  const now = new Date();
  const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${month}/${crypto.randomUUID()}${suffix ? `-${suffix}` : ""}`;
}
/** Counts bytes and fails as soon as more than `expected` arrive. */
function counter(expected: number) {
  let seen = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      if (seen > expected)
        return done(
          new StorageError("More bytes than declared", "SIZE_MISMATCH"),
        );
      done(null, chunk);
    },
    flush(done) {
      done(
        seen === expected
          ? null
          : new StorageError("Fewer bytes than declared", "SIZE_MISMATCH"),
      );
    },
  });
  return stream;
}
export class LocalStore implements ObjectStore {
  readonly driver = "local" as const;
  readonly profile: string;
  private readonly root: string;
  constructor(profile: LocalProfileConfig) {
    this.profile = profile.id;
    this.root = resolve(profile.root);
  }
  private path(key: string) {
    assertKey(key);
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep))
      throw new StorageError("Invalid storage key", "INVALID_KEY");
    return path;
  }
  /** Rejects any directory component that resolves outside the root (symlink escape). */
  private async inside(path: string) {
    const [root, real] = await Promise.all([
      realpath(this.root),
      realpath(path),
    ]);
    if (real !== root && !real.startsWith(root + sep))
      throw new StorageError("Storage path escapes its root", "INVALID_KEY");
  }
  async check() {
    await mkdir(this.root, { recursive: true });
  }
  async put(
    key: string,
    body: Readable,
    options: { bytes: number; contentType: string },
  ) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await this.inside(dirname(path));
    const partial = `${path}.part-${crypto.randomUUID()}`;
    try {
      await pipeline(
        body,
        counter(options.bytes),
        createWriteStream(partial, { flags: "wx" }),
      );
      await rename(partial, path);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
  }
  async stat(key: string) {
    const path = this.path(key);
    try {
      await this.inside(dirname(path));
      const info = await stat(path);
      return info.isFile()
        ? { bytes: info.size, lastModified: info.mtime }
        : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async read(key: string, options?: { range?: ByteRange }) {
    const path = this.path(key);
    try {
      await this.inside(dirname(path));
      // O_NOFOLLOW rejects a symlink placed at the object path itself.
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      return handle.createReadStream(
        options?.range
          ? { start: options.range.start, end: options.range.end }
          : {},
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT")
        throw new StorageError("Stored object not found", "NOT_FOUND");
      if (code === "ELOOP")
        throw new StorageError("Storage path escapes its root", "INVALID_KEY");
      throw error;
    }
  }
  async delete(key: string) {
    try {
      await unlink(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
const status = (error: unknown) =>
  (error as { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode;
export class S3Store implements ObjectStore {
  readonly driver = "s3" as const;
  readonly profile: string;
  readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  constructor(
    profile: S3ProfileConfig,
    private readonly autoCreate = false,
  ) {
    this.profile = profile.id;
    this.bucket = profile.bucket;
    this.prefix = profile.prefix ? profile.prefix.replace(/\/?$/, "/") : "";
    this.client = new S3Client({
      endpoint: profile.endpoint,
      region: profile.region,
      forcePathStyle: profile.forcePathStyle,
      ...(profile.accessKeyId && profile.secretAccessKey
        ? {
            credentials: {
              accessKeyId: profile.accessKeyId,
              secretAccessKey: profile.secretAccessKey,
            },
          }
        : {}),
    });
  }
  private key(key: string) {
    assertKey(key);
    return this.prefix + key;
  }
  async check() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (status(error) !== 404 || !this.autoCreate)
        throw new StorageError(
          `S3 bucket for storage profile "${this.profile}" is not reachable` +
            (status(error) === 404
              ? " (it does not exist; create it or set S3_AUTO_CREATE_BUCKET=1 for local MinIO)"
              : ""),
          "UNAVAILABLE",
        );
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }
  async put(
    key: string,
    body: Readable,
    options: { bytes: number; contentType: string },
  ) {
    const Key = this.key(key);
    // The SDK does not watch its body stream for errors, so a short, long or
    // interrupted source would leave the request hanging, and an error on the
    // body would surface as an uncaught exception in the SDK's own wrapper
    // stream. Abort the request instead and close the body without an error.
    const abort = new AbortController();
    let failure: unknown;
    const check = counter(options.bytes);
    const Body = new PassThrough();
    const fail = (error: unknown) => {
      if (failure) return;
      failure = error;
      abort.abort();
      body.destroy();
      check.destroy();
      Body.destroy();
    };
    // Not `pipeline`: it would destroy Body with the error.
    body.on("error", fail);
    check.on("error", fail);
    body.pipe(check).pipe(Body);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key,
          Body,
          ContentLength: options.bytes,
          ContentType: options.contentType,
        }),
        { abortSignal: abort.signal },
      );
    } catch (error) {
      throw failure ?? error;
    }
    if (failure) {
      // The store accepted `bytes` bytes, but the source turned out to be invalid.
      await this.delete(key).catch(() => {});
      throw failure;
    }
  }
  async stat(key: string) {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(key) }),
      );
      return {
        bytes: Number(head.ContentLength),
        lastModified: head.LastModified,
      };
    } catch (error) {
      if (status(error) === 404) return undefined;
      throw error;
    }
  }
  async read(
    key: string,
    options?: { range?: ByteRange; signal?: AbortSignal },
  ) {
    try {
      const out = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.key(key),
          ...(options?.range
            ? { Range: `bytes=${options.range.start}-${options.range.end}` }
            : {}),
        }),
        { abortSignal: options?.signal },
      );
      return out.Body as Readable;
    } catch (error) {
      if (status(error) === 404)
        throw new StorageError("Stored object not found", "NOT_FOUND");
      throw error;
    }
  }
  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) }),
    );
  }
}
export function createStore(profile: StorageProfileConfig): ObjectStore {
  return profile.driver === "s3"
    ? new S3Store(profile, config.storage.autoCreateBucket)
    : new LocalStore(profile);
}
const stores = new Map(
  config.storage.profiles.map((profile) => [profile.id, createStore(profile)]),
);
/** Tests may register a temporary profile. */
export function registerStore(store: ObjectStore) {
  stores.set(store.profile, store);
}
/** Never falls back to another profile: a missing profile is an explicit error. */
export function storeFor(profile: string): ObjectStore {
  const store = stores.get(profile);
  if (!store)
    throw new StorageError(
      `Storage profile "${profile}" is not configured on this server`,
      "UNAVAILABLE",
    );
  return store;
}
export const writeStore = () => storeFor(config.storage.writeProfile);
/** Startup check of the write profile only; read profiles are checked on use. */
export async function checkStorage() {
  await writeStore().check();
}
