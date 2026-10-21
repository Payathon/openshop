import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Where merchant uploads (product images for now) live. The app never keeps files on its own
// disk in production, so instances stay disposable: LocalDiskStorage is for local runs and the
// single-machine demo, and an S3-compatible store (Alibaba Cloud OSS) replaces it once there is
// more than one instance. Keys are random and never reused, so URLs can be cached forever.

export interface Storage {
  readonly name: string;
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  // Public URL a page can put in <img src>.
  url(key: string): string;
  delete(key: string): Promise<void>;
}

export const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;
export type ImageType = keyof typeof IMAGE_TYPES;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const KEY = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.(?:jpg|png|webp|gif)$/;

export function newImageKey(shopId: string, type: ImageType) {
  return `shops/${shopId.toLowerCase()}/${randomBytes(12).toString("hex")}.${IMAGE_TYPES[type]}`;
}

// The declared Content-Type is the client's word; the first bytes are the file's.
export function sniffImage(data: Uint8Array): ImageType | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => data[i] === b);
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...data.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export class LocalDiskStorage implements Storage {
  readonly name = "local";

  // Files are served by the app itself at `${publicBase}/<key>` (see app.ts).
  constructor(
    private readonly dir: string,
    private readonly publicBase: string,
  ) {}

  private path(key: string) {
    if (!KEY.test(key)) throw new Error(`invalid storage key: ${key}`);
    return join(this.dir, key);
  }

  async put(key: string, data: Uint8Array) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  url(key: string) {
    return `${this.publicBase}/${key}`;
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }

  // Null for unknown or malformed keys, so the file route can 404 without leaking why.
  async read(key: string): Promise<{ data: Uint8Array<ArrayBuffer>; contentType: string } | null> {
    if (!KEY.test(key)) return null;
    const buf = await readFile(join(this.dir, key)).catch(() => null);
    if (!buf) return null;
    const data = new Uint8Array(buf);
    const ext = key.slice(key.lastIndexOf(".") + 1);
    const contentType = Object.entries(IMAGE_TYPES).find(([, e]) => e === ext)![0];
    return { data, contentType };
  }
}

// TODO(M5 deploy, >1 instance): OssStorage against Alibaba Cloud OSS's S3-compatible endpoint
// (e.g. https://oss-ap-southeast-1.aliyuncs.com) with @aws-sdk/client-s3: put = PutObject with
// ContentType and Cache-Control immutable, url = CDN or bucket domain + key, delete = DeleteObject.
