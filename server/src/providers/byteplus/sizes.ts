/**
 * Seedream sizes, from limits learned from real 400 responses: at least
 * 1280×720 pixels; Seedream 5.0 Pro at most 4,624,220 pixels and no 4K preset;
 * a 1K/2K preset alone ignores the aspect ratio, so ratio + tier is sent as WxH.
 */
export const SEEDREAM_MIN_PIXELS = 1280 * 720;
export const SEEDREAM_MAX_PIXELS = 4096 * 4096;
/** 2K-tier pixel sizes per aspect ratio. */
const BASE_2K: Record<string, [number, number]> = {
  "1:1": [2048, 2048],
  "4:3": [2304, 1728],
  "3:4": [1728, 2304],
  "16:9": [2560, 1440],
  "9:16": [1440, 2560],
  "3:2": [2496, 1664],
  "2:3": [1664, 2496],
  "21:9": [3024, 1296],
};
const TIER: Record<string, number> = { "1K": 0.5, "2K": 1, "4K": 2 };
export interface PixelLimits {
  min?: number;
  max?: number;
}
/** Scale W×H into the model's pixel area, keeping the ratio. */
export function fitArea(
  width: number,
  height: number,
  limits: PixelLimits = {},
) {
  const min = limits.min ?? SEEDREAM_MIN_PIXELS;
  const max = limits.max ?? SEEDREAM_MAX_PIXELS;
  const area = width * height;
  if (area < min) {
    const k = Math.sqrt(min / area);
    return `${Math.ceil(width * k)}x${Math.ceil(height * k)}`;
  }
  if (area > max) {
    const k = Math.sqrt(max / area);
    return `${Math.floor(width * k)}x${Math.floor(height * k)}`;
  }
  return `${Math.round(width)}x${Math.round(height)}`;
}
function base(ratio: string | undefined): [number, number] | undefined {
  if (!ratio) return undefined;
  if (BASE_2K[ratio]) return BASE_2K[ratio];
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio.trim());
  if (!m) return undefined;
  const r = Number(m[1]) / Number(m[2]);
  if (!Number.isFinite(r) || r <= 0) return undefined;
  const area = 2560 * 1440;
  return [Math.sqrt(area * r), Math.sqrt(area / r)];
}
/** The `size` Seedream gets: explicit pixels, else ratio at the tier, else the tier preset, else 2K. */
export function imageSize(
  params: {
    ratio?: unknown;
    resolution?: unknown;
    width?: unknown;
    height?: unknown;
  },
  limits: PixelLimits = {},
) {
  const w = Number(params.width),
    h = Number(params.height);
  if (w > 0 && h > 0) return fitArea(w, h, limits);
  const tier =
    typeof params.resolution === "string"
      ? params.resolution.toUpperCase()
      : undefined;
  const scale = tier && TIER[tier] ? TIER[tier] : 1;
  const b = base(typeof params.ratio === "string" ? params.ratio : undefined);
  if (b) return fitArea(b[0] * scale, b[1] * scale, limits);
  if (tier && TIER[tier])
    return (2048 * TIER[tier]) ** 2 > (limits.max ?? SEEDREAM_MAX_PIXELS)
      ? "2K"
      : tier;
  return "2K";
}
/** "image area must be at most N pixels" → the limit, or undefined. */
export function sizeLimitFromError(message: string) {
  const m = /image area must be at (least|most) (\d+) pixels/i.exec(message);
  return m
    ? {
        bound:
          m[1].toLowerCase() === "least" ? ("min" as const) : ("max" as const),
        pixels: Number(m[2]),
      }
    : undefined;
}
/** Rescale a W×H size (or a tier preset, taken as square) to a named pixel limit. */
export function rescaleToLimit(
  size: string,
  limit: { bound: "min" | "max"; pixels: number },
) {
  const px = /^(\d+)x(\d+)$/.exec(size);
  const side = 2048 * (TIER[size.toUpperCase()] ?? 1);
  const [w, h] = px ? [Number(px[1]), Number(px[2])] : [side, side];
  const k = Math.sqrt(limit.pixels / (w * h));
  return limit.bound === "min"
    ? `${Math.ceil(w * k)}x${Math.ceil(h * k)}`
    : `${Math.floor(w * k)}x${Math.floor(h * k)}`;
}
