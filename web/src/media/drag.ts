import type { Asset, AssetKind } from "../../../contracts/index.ts";
/** dataTransfer type for assets dragged out of the Media browser. */
export const ASSET_MIME = "application/x-zcanvas-asset";
export type DraggedAsset = Pick<Asset, "id" | "kind"> & { name?: string };
export function writeAssets(transfer: DataTransfer, assets: Asset[]) {
  const payload: DraggedAsset[] = assets.map(({ id, kind, name }) => ({
    id,
    kind,
    name,
  }));
  transfer.setData(ASSET_MIME, JSON.stringify(payload));
  transfer.effectAllowed = "copy";
}
export const hasAssets = (transfer: DataTransfer) =>
  transfer.types.includes(ASSET_MIME);
export function readAssets(transfer: DataTransfer): DraggedAsset[] {
  try {
    const value = JSON.parse(transfer.getData(ASSET_MIME));
    return Array.isArray(value)
      ? value.filter(
          (a): a is DraggedAsset =>
            typeof a?.id === "string" &&
            ["image", "video", "audio"].includes(a.kind as AssetKind),
        )
      : [];
  } catch {
    return [];
  }
}
