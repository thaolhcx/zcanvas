import { createContext, useContext } from "react";
import type { Graph } from "../../graph/src/index.ts";
export const GraphContext = createContext<Graph | null>(null);
export function useGraph() {
  const graph = useContext(GraphContext);
  if (!graph) throw new Error("Missing graph");
  return graph;
}
