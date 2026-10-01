import type { AssetSearchResponse } from "../../../contracts/index.ts";
/** How long typing must pause before search by meaning runs. */
export const SEMANTIC_DELAY = 400;
const reasons: Record<string, string> = {
  disabled: "Search by meaning is turned off on this server.",
  unavailable: "Search by meaning is not available right now.",
  timeout: "Search by meaning took too long, so only names were matched.",
  indexing: "Files are still being indexed.",
};
/** The quiet badge next to the results when search could not use meaning. */
export function searchBadge(
  response: Pick<AssetSearchResponse, "mode" | "semantic"> | undefined,
): { label: string; reason: string } | undefined {
  if (!response) return undefined;
  const { mode, semantic } = response;
  if (mode === "name")
    return {
      label: "Name matches only",
      reason:
        semantic.message && !reasons[semantic.state]
          ? semantic.message
          : (reasons[semantic.state] ?? reasons.unavailable),
    };
  if (semantic.state === "indexing" && semantic.pending)
    return {
      label: "Still indexing",
      reason: `${semantic.pending} ${semantic.pending === 1 ? "file is" : "files are"} not searchable by meaning yet.`,
    };
  return undefined;
}
