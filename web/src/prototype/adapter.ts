// Adapter: turns prototype store data into the kit's GenSource.
// The real canvas will have its own adapter over Graph + runs; the kit doesn't change.
import { useMemo } from "react";
import type { GenSource, GenStatus } from "../kit/types.ts";
import { estimate, modelOf, validate } from "../kit/logic.ts";
import { NODES, modelsFor } from "./catalog.ts";
import { inputsOf, useProto } from "./store.ts";

export function useGenSource(id: string, opts?: { addInput?: () => void }): GenSource | undefined {
  const node = useProto((s) => s.nodes[id]);
  const edges = useProto((s) => s.edges);
  const nodes = useProto((s) => s.nodes);
  const api = useProto.getState();
  return useMemo(() => {
    if (!node || node.type === "sticky") return undefined;
    const spec = NODES[node.type];
    const models = modelsFor(spec);
    const model = modelOf(models, node.value.model);
    const inputs = inputsOf({ nodes, edges }, id);
    const busy = node.status.state === "queued" || node.status.state === "running";
    const status: GenStatus = busy
      ? node.status
      : node.history.some((e) => !e.cancelled)
        ? { state: "done" }
        : node.status.state === "cancelled"
          ? node.status
          : node.value.prompt.trim() || inputs.length
            ? { state: "ready" }
            : { state: "empty" };
    return {
      node: spec,
      models,
      value: node.value,
      setValue: (patch) => api.setValue(id, patch),
      setParam: (k, v) => api.setParam(id, k, v),
      changeModel: (key) => api.changeModel(id, key),
      inputs,
      removeInput: (refId) =>
        edges.some((e) => e.id === refId) ? api.disconnect(refId) : api.removeUpload(id, refId),
      setRole: (refId, role) => api.setRole(id, refId, role),
      addInput: opts?.addInput,
      status,
      issues: validate(spec, model, node.value, inputs),
      estimate: estimate(spec, model, node.value, inputs),
      run: () => api.run(id),
      cancel: (jobId) => api.cancel(id, jobId),
      jobs: node.jobs ?? [],
      history: node.history,
      active: node.active,
      setActive: (entryId, index) => api.setActive(id, entryId, index),
      reEdit: (entryId) => api.reEdit(id, entryId),
    };
  }, [node, edges, nodes, id, api, opts?.addInput]);
}
