import type {
  Asset,
  AssetDeleteResponse,
  AssetListResponse,
  AssetSearchResponse,
  AssetUsageResponse,
  CanvasInfo,
  SpacesResponse,
} from "../../../contracts/index.ts";
import { API, ApiRequestError, request } from "../api.ts";
import type { MediaFilters } from "./selection.ts";
const query = (values: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
};
export const PAGE_SIZE = 60;
export const listAssets = (
  spaceId: string,
  filters: MediaFilters,
  cursor?: string,
  signal?: AbortSignal,
) =>
  request<AssetListResponse>(
    `/assets${query({
      spaceId,
      q: filters.q.trim(),
      kind: filters.kind,
      source: filters.source,
      sort: filters.sort,
      cursor,
      limit: PAGE_SIZE,
    })}`,
    { signal },
  );
export const searchAssets = (
  spaceId: string,
  filters: MediaFilters,
  signal?: AbortSignal,
) =>
  request<AssetSearchResponse>(
    `/assets/search${query({
      spaceId,
      q: filters.q.trim(),
      kind: filters.kind,
      source: filters.source,
      limit: 50,
    })}`,
    { signal },
  );
export const getSpaces = () => request<SpacesResponse>("/spaces");
export const getCanvasInfo = (canvasId: string) =>
  request<CanvasInfo>(`/canvases/${encodeURIComponent(canvasId)}/info`);
export const getAsset = (id: string, signal?: AbortSignal) =>
  request<Asset>(`/assets/${encodeURIComponent(id)}`, { signal });
export const renameAsset = (id: string, name: string) =>
  request<Asset>(`/assets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
export const assetUsage = (id: string, canvasId: string) =>
  request<AssetUsageResponse>(
    `/assets/${encodeURIComponent(id)}/usage${query({ canvasId })}`,
  );
export const deleteAsset = (id: string, canvasId?: string) =>
  request<AssetDeleteResponse>(
    `/assets/${encodeURIComponent(id)}${query({ canvasId })}`,
    { method: "DELETE" },
  );
export const getStock = () => request<unknown>("/stock");
export const downloadUrl = (asset: Asset) => `${asset.url}?download=1`;
/**
 * Multipart upload with progress (fetch cannot report upload progress).
 * Targets the canvas space when `canvasId` is given; the server checks access.
 */
export function uploadAsset(
  file: File,
  target: { canvasId?: string; spaceId?: string },
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
) {
  return new Promise<Asset>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `${API}/assets${query(target.canvasId ? { canvasId: target.canvasId } : { spaceId: target.spaceId })}`,
    );
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      const body = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as Asset);
      else
        reject(
          new ApiRequestError(
            body.error ?? `Upload failed (${xhr.status})`,
            xhr.status,
            body.code,
            body,
          ),
        );
    };
    xhr.onerror = () =>
      reject(new ApiRequestError("The upload did not finish", 0));
    xhr.onabort = () =>
      reject(new ApiRequestError("The upload was cancelled", 0, "ABORTED"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    const data = new FormData();
    data.append("file", file);
    xhr.send(data);
  });
}
const cache = new Map<string, Promise<Asset>>();
/**
 * Asset details shared by canvas nodes: many nodes often use one file, and
 * each node shows it twice (preview and field). `revision` comes from the
 * Media store and changes after a rename or delete.
 */
export function cachedAsset(id: string, revision = 0) {
  const key = `${id}@${revision}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = getAsset(id);
    cache.set(key, pending);
    // Failures and stale revisions are not kept.
    pending.catch(() => cache.delete(key));
    cache.delete(`${id}@${revision - 1}`);
  }
  return pending;
}
