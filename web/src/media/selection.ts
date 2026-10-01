import type {
  Asset,
  AssetKind,
  AssetSort,
  AssetSourceType,
} from "../../../contracts/index.ts";
export interface MediaFilters {
  q: string;
  kind?: AssetKind;
  source?: AssetSourceType;
  sort: AssetSort;
}
export const emptyFilters = (): MediaFilters => ({
  q: "",
  sort: "created_desc",
});
/**
 * Whether an asset would be listed under these filters. `semanticIds` holds
 * the current search hits: a semantic match counts even when the name does not.
 */
export function matchesFilters(
  asset: Asset,
  filters: MediaFilters,
  semanticIds?: ReadonlySet<string>,
) {
  if (filters.kind && asset.kind !== filters.kind) return false;
  if (filters.source && (asset.source?.type ?? "upload") !== filters.source)
    return false;
  const q = filters.q.trim().toLowerCase();
  if (!q) return true;
  return (
    (asset.name ?? "").toLowerCase().includes(q) ||
    (semanticIds?.has(asset.id) ?? false)
  );
}
/** Selection keeps the assets themselves, so items outside the filter can still be added. */
export type Selection = ReadonlyMap<string, Asset>;
export function toggle(selection: Selection, asset: Asset): Selection {
  const next = new Map(selection);
  if (next.has(asset.id)) next.delete(asset.id);
  else next.set(asset.id, asset);
  return next;
}
export function outsideFilter(
  selection: Selection,
  filters: MediaFilters,
  semanticIds?: ReadonlySet<string>,
) {
  let count = 0;
  for (const asset of selection.values())
    if (!matchesFilters(asset, filters, semanticIds)) count++;
  return count;
}
/** Drops ids that are gone (deleted, or no longer visible to the caller). */
export function without(selection: Selection, ids: Iterable<string>) {
  const next = new Map(selection);
  for (const id of ids) next.delete(id);
  return next.size === selection.size ? selection : next;
}
export const selectionLabel = (count: number, outside: number) =>
  `${count} selected${outside ? ` · ${outside} outside this filter` : ""}`;
