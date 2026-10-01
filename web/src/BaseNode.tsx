import { memo, useContext, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Image,
  Film,
  Music2,
  Type,
  GitBranch,
  ArrowUpRight,
  Upload,
  WandSparkles,
  CirclePlus,
  Images,
} from "lucide-react";
import {
  isUnfilled,
  type Asset,
  type Output,
  type RecipeNode,
} from "../../contracts/index.ts";
import { useGraph, PortPaletteContext } from "./context.ts";
import { ParamForm } from "./Params.tsx";
import {
  action,
  EMPTY_ISSUES,
  EMPTY_JOBS,
  useCanvas,
  useRun,
} from "./store.ts";
import { post, request, statusOf } from "./api.ts";
import { media, useMedia } from "./media/store.ts";
import { acceptedMediaKinds } from "./connections.ts";
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
    runStatus = useRun((s) => s.run?.status),
    changed = useRun((s) => s.changed[id] ?? false);
  if (!runStatus) return null;
  const states = jobs.map((j) => j.status),
    done = states.filter((s) => s === "done").length;
  const status = states.includes("failed")
    ? "failed"
    : states.includes("running")
      ? "running"
      : states.includes("queued") || !states.length
        ? runStatus === "cancelled"
          ? "cancelled"
          : "queued"
        : states.every((s) => s === "skipped")
          ? "skipped"
          : states.includes("cancelled")
            ? "cancelled"
            : "done";
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
  const [uploaded, setUploaded] = useState<Asset>(),
    [missing, setMissing] = useState<"deleted" | "unavailable">();
  const assetId =
    node?.type === "input.asset" && typeof node.params.asset === "string"
      ? node.params.asset
      : undefined;
  // Renames and deletes in the Media browser bump this, so the node refetches.
  const revision = useMedia((s) => (assetId ? s.revisions[assetId] : 0));
  useEffect(() => {
    let live = true;
    setUploaded(undefined);
    setMissing(undefined);
    if (assetId)
      void request<Asset>(`/assets/${assetId}`)
        .then((a) => {
          if (live) setUploaded(a);
        })
        .catch((e) => {
          if (!live) return;
          if (statusOf(e) === 410) setMissing("deleted");
          else if (statusOf(e) === 404) setMissing("unavailable");
        });
    return () => {
      live = false;
    };
  }, [assetId, revision]);
  if (!node) return null;
  if (missing && !jobs.some((j) => j.outputs))
    return (
      <div className="preview missing-file nodrag" role="status">
        <strong>
          {missing === "deleted" ? "Deleted file" : "File not available"}
        </strong>
        <span>
          {missing === "deleted"
            ? "This file was deleted. Choose another file."
            : "This file is missing or you no longer have access. Choose another file."}
        </span>
        <button
          onClick={() =>
            media.openPicker({
              kinds: acceptedMediaKinds(graph.toRecipe(), graph.registry, id),
              onPick: (asset) =>
                action(() => graph.setParam(id, "asset", asset.id)),
            })
          }
        >
          <Images size={13} />
          Choose another file
        </button>
      </div>
    );
  const type = graph.registry.get(node.type)!,
    port = type.ui?.previewPort ?? type.outputs[0]?.key;
  const values = jobs.flatMap((j) => {
    const output = j.outputs?.[port];
    return output ? (Array.isArray(output) ? output : [output]) : [];
  });
  const output: Output | undefined = values[0] ?? uploaded;
  if (output && "id" in output)
    return (
      <div className={`preview nodrag ${values[0] ? "result-preview" : ""}`}>
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
  if (node.type === "input.prompt") return null;
  return (
    <div
      className="preview empty"
      data-aspect={
        node.type === "image.generate"
          ? String(node.params.aspect ?? "9:16")
          : undefined
      }
    >
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
function ConnectionPoint({
  id,
  side,
  connectable,
  compatible,
}: {
  id: string;
  side: "source" | "target";
  connectable: boolean;
  compatible?: boolean;
}) {
  const openPalette = useContext(PortPaletteContext);
  const down = useRef<{ x: number; y: number } | undefined>(undefined);
  return (
    <div
      className={`handle-hit handle-${side} ${compatible === false ? "incompatible" : ""}`}
    >
      <Handle
        id={side === "source" ? "out" : "in"}
        type={side}
        position={side === "source" ? Position.Right : Position.Left}
        isConnectable={connectable}
        isConnectableStart={connectable}
        isConnectableEnd={connectable}
        aria-label={side === "source" ? "Connect output" : "Connect input"}
        role="button"
        tabIndex={0}
        onMouseDown={(event) => {
          down.current = { x: event.clientX, y: event.clientY };
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (
            !down.current ||
            Math.hypot(
              event.clientX - down.current.x,
              event.clientY - down.current.y,
            ) <= 4
          )
            openPalette(id, side);
          down.current = undefined;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            openPalette(id, side);
          }
        }}
      />
      <span className="handle-plus">
        <CirclePlus size={21} />
      </span>
    </div>
  );
}
export const BaseNode = memo(function BaseNode({ id, selected }: NodeProps) {
  const graph = useGraph(),
    node = useCanvas((s) => s.byId[id]),
    compact = useCanvas((s) => s.compact),
    issues = useCanvas((s) => s.issues[id] ?? EMPTY_ISSUES),
    compat = useCanvas((s) => s.compat),
    templateInput = useCanvas((s) =>
      s.templateInputs.some(
        (i) => i.nodeId === id && isUnfilled(s.byId[id]?.params[i.paramKey]),
      ),
    );
  const jobs = useRun((s) => s.jobs[id] ?? EMPTY_JOBS),
    runId = useRun((s) => s.run?.runId),
    runStatus = useRun((s) => s.run?.status);
  if (!node) return null;
  const entry = graph.registry.get(node.type)!,
    Icon = node.type === "input.asset" ? Upload : icons[entry.category],
    wrong = issues.filter(
      (i) => !["INPUT_REQUIRED", "PARAM_REQUIRED"].includes(i.code),
    );
  const running = jobs.find((j) => j.status === "running");
  return (
    <article
      className={`canvas-node ${selected ? "selected" : ""} ${compact ? "compact" : ""} ${wrong.length ? "invalid" : ""} ${templateInput ? "template-input" : ""}`}
      data-testid={`node-${node.type}`}
    >
      <header>
        <Icon size={16} />
        <button
          className="node-title"
          onDoubleClick={() => {
            const label = prompt("Node label", node.label || entry.title);
            if (label !== null) action(() => graph.setLabel(id, label));
          }}
        >
          {node.label || entry.title}
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
      <ConnectionPoint
        id={id}
        side="target"
        connectable={entry.inputs.length > 0}
        compatible={compat ? compat.has(id) : undefined}
      />
      <ConnectionPoint
        id={id}
        side="source"
        connectable={entry.outputs.length > 0}
      />
      {running && (
        <div
          className="node-progress"
          style={{ width: `${(running.progress ?? 0.1) * 100}%` }}
        />
      )}
    </article>
  );
});
