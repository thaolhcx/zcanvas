import { memo, useEffect, useState } from "react";
import { Handle, Position, useConnection, type NodeProps } from "@xyflow/react";
import {
  Image,
  Film,
  Music2,
  Type,
  GitBranch,
  ArrowUpRight,
  Upload,
  WandSparkles,
} from "lucide-react";
import type { Asset, Output, RecipeNode } from "../../contracts/index.ts";
import { validate } from "../../contracts/index.ts";
import { useGraph } from "./context.ts";
import { ParamForm } from "./Params.tsx";
import {
  action,
  EMPTY_ISSUES,
  EMPTY_JOBS,
  useCanvas,
  useRun,
} from "./store.ts";
import { post, request } from "./api.ts";
const icons = {
  input: Type,
  image: Image,
  video: Film,
  audio: Music2,
  flow: GitBranch,
  output: ArrowUpRight,
  text: Type,
};
export function Status({ id }: { id: string }) {
  const jobs = useRun((s) => s.jobs[id] ?? EMPTY_JOBS),
    node = useCanvas((s) => s.byId[id]);
  const run = useRun((s) => s.run),
    snapshot = useRun((s) => s.run && s.snapshots[s.run.runId]);
  if (!run) return null;
  const states = jobs.map((j) => j.status),
    done = states.filter((s) => s === "done").length;
  const status = states.includes("failed")
    ? "failed"
    : states.includes("running")
      ? "running"
      : states.includes("queued") || !states.length
        ? run.status === "cancelled"
          ? "cancelled"
          : "queued"
        : states.every((s) => s === "skipped")
          ? "skipped"
          : states.includes("cancelled")
            ? "cancelled"
            : "done";
  const previous = snapshot?.nodes.find((n) => n.id === id),
    changed =
      previous &&
      JSON.stringify(previous.params) !== JSON.stringify(node?.params);
  return (
    <span
      className={`status ${status}`}
      title={jobs.find((j) => j.error)?.error?.message ?? status}
    >
      {status}
      {status === "running"
        ? ` ${Math.round((jobs.reduce((n, j) => n + (j.progress ?? 0), 0) / Math.max(jobs.length, 1)) * 100)}%`
        : ""}
      {jobs.length > 1 ? ` ${done}/${jobs.length}` : ""}
      {changed ? " · changed" : ""}
    </span>
  );
}
export function Preview({ id }: { id: string }) {
  const graph = useGraph(),
    node = useCanvas((s) => s.byId[id]),
    jobs = useRun((s) => s.jobs[id] ?? EMPTY_JOBS);
  const [uploaded, setUploaded] = useState<Asset>();
  useEffect(() => {
    let live = true;
    if (node?.type === "input.asset" && node.params.asset)
      void request<Asset>(`/assets/${node.params.asset}`)
        .then((a) => {
          if (live) setUploaded(a);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [node?.params.asset]);
  if (!node) return null;
  const type = graph.registry.get(node.type)!,
    port = type.ui?.previewPort ?? type.outputs[0]?.key;
  const values = jobs.flatMap((j) => {
    const output = j.outputs?.[port];
    return output ? (Array.isArray(output) ? output : [output]) : [];
  });
  const output: Output | undefined = values[0] ?? uploaded;
  if (output && "id" in output)
    return (
      <div className="preview nodrag">
        <img
          src={output.thumbUrl ?? undefined}
          alt={output.kind === "audio" ? "" : `${type.title} preview`}
          style={{ display: output.thumbUrl ? "block" : "none" }}
        />
        {output.kind === "audio" && (
          <div className="waveform">▂▅▃▆▅▂▇▃▅▆▂▅▃▆▅▂</div>
        )}
        <span className="preview-tag">
          {output.kind}
          {values.length > 1 ? ` · ${values.length} assets` : ""}
        </span>
        {node.type === "output.export" && (
          <a
            href={output.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open exported video"
          >
            Open clip <ArrowUpRight size={13} />
          </a>
        )}
      </div>
    );
  if (node.type === "input.prompt")
    return (
      <div className="text-preview">
        {String(node.params.text ?? "Describe your scene below.")}
      </div>
    );
  return (
    <div className="preview empty">
      <WandSparkles size={22} />
      <span>
        {type.outputs[0]?.kind
          .toString()
          .replace("list<", "")
          .replace(">", "") ?? "output"}
      </span>
    </div>
  );
}
export const BaseNode = memo(function BaseNode({ id, selected }: NodeProps) {
  const graph = useGraph(),
    node = useCanvas((s) => s.byId[id]),
    compact = useCanvas((s) => s.compact),
    issues = useCanvas((s) => s.issues[id] ?? EMPTY_ISSUES),
    connection = useConnection();
  const jobs = useRun((s) => s.jobs[id] ?? EMPTY_JOBS),
    runId = useRun((s) => s.run?.runId),
    runStatus = useRun((s) => s.run?.status);
  if (!node) return null;
  const entry = graph.registry.get(node.type)!,
    Icon = icons[entry.category],
    wrong = issues.filter(
      (i) => !["INPUT_REQUIRED", "PARAM_REQUIRED"].includes(i.code),
    );
  const running = jobs.find((j) => j.status === "running");
  const matches = (port: string) => {
    if (
      !connection.inProgress ||
      !connection.fromNode ||
      !connection.fromHandle
    )
      return true;
    const recipe = graph.toRecipe();
    recipe.edges = recipe.edges.filter(
      (e) => e.target !== id || e.targetPort !== port,
    );
    recipe.edges.push({
      id: "candidate",
      source: connection.fromNode.id,
      sourcePort: connection.fromHandle.id ?? "",
      target: id,
      targetPort: port,
    });
    return !validate(recipe, graph.registry).some(
      (i) => !["INPUT_REQUIRED", "PARAM_REQUIRED"].includes(i.code),
    );
  };
  return (
    <article
      className={`canvas-node ${selected ? "selected" : ""} ${compact ? "compact" : ""} ${wrong.length ? "invalid" : ""}`}
      data-testid={`node-${node.type}`}
    >
      <header>
        <Icon size={16} />
        <button
          className="node-title nodrag"
          onDoubleClick={() => {
            const label = prompt("Node label", node.label ?? entry.title);
            if (label !== null) action(() => graph.setLabel(id, label));
          }}
        >
          {node.label ?? entry.title}
        </button>
        {issues.length > 0 && (
          <span
            className={`issue-dot ${wrong.length ? "red" : ""}`}
            title={issues.map((i) => i.message).join("\n")}
          />
        )}
        <Status id={id} />
      </header>
      {!compact && (
        <>
          <Preview id={id} />
          <ParamForm node={node} inline />
          {wrong.map((issue, i) => (
            <small key={i} className="node-error">
              {issue.message}
            </small>
          ))}
          {jobs.some((j) => j.status === "failed") && (
            <div className="node-error">
              {jobs.find((j) => j.error)?.error?.code}
              <button
                className="nodrag"
                disabled={runStatus === "running"}
                onClick={() => {
                  void post(`/runs/${runId}/retry`, { nodeId: id }).catch((e) =>
                    useCanvas.setState({ error: e.message }),
                  );
                }}
              >
                Retry node
              </button>
            </div>
          )}
        </>
      )}
      {entry.inputs.map((p, i) => (
        <Handle
          key={p.key}
          id={p.key}
          type="target"
          position={Position.Left}
          title={`${p.label ?? p.key} · ${p.kind}`}
          style={{
            top: compact ? 14 + i * 20 : 64 + i * 28,
            opacity: matches(p.key) ? 1 : 0.15,
          }}
          className={`kind-${String(p.kind).replace("list<", "").replace(">", "")}`}
        />
      ))}
      {entry.outputs.map((p, i) => (
        <Handle
          key={p.key}
          id={p.key}
          type="source"
          position={Position.Right}
          title={`${p.label ?? p.key} · ${p.kind}`}
          style={{ top: compact ? 14 + i * 20 : 64 + i * 28 }}
          className={`kind-${String(p.kind).replace("list<", "").replace(">", "")}`}
        />
      ))}
      {running && (
        <div
          className="node-progress"
          style={{ width: `${(running.progress ?? 0.1) * 100}%` }}
        />
      )}
    </article>
  );
});
