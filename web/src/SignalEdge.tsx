import { memo, useSyncExternalStore } from "react";
import { BaseEdge, type EdgeProps } from "@xyflow/react";

import { useCanvas } from "./store.ts";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const subscribe = (notify: () => void) => {
  reducedMotion.addEventListener("change", notify);
  return () => reducedMotion.removeEventListener("change", notify);
};
const getReducedMotion = () => reducedMotion.matches;

export const SignalEdge = memo(function SignalEdge(props: EdgeProps) {
  const active = useCanvas(
    (s) =>
      s.selected.includes(props.source) || s.selected.includes(props.target),
  );
  const reduced = useSyncExternalStore(subscribe, getReducedMotion);
  const { id, sourceX, sourceY, targetX, targetY } = props;
  // Single horizontal anchors share a 60px stem before the curves separate.
  const sourceLead = sourceX + 60,
    targetLead = targetX - 60,
    gap = targetLead - sourceLead;
  const offset = Math.max(
    60,
    gap >= 0
      ? gap / 2
      : 25 * (props.pathOptions?.curvature ?? 0.25) * Math.sqrt(-gap),
  );
  const path = `M${sourceX},${sourceY} L${sourceLead},${sourceY} C${sourceLead + offset},${sourceY} ${targetLead - offset},${targetY} ${targetLead},${targetY} L${targetX},${targetY}`;
  const left = Math.min(sourceX, targetX, targetLead - offset) - 24,
    right = Math.max(sourceX, targetX, sourceLead + offset) + 24;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={props.style}
        markerStart={props.markerStart}
        markerEnd={props.markerEnd}
        interactionWidth={props.interactionWidth}
      />
      {active && !reduced && (
        <>
          <defs>
            <radialGradient id={`${id}-g`}>
              <stop offset="0%" stopColor="#fff" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.01)" />
            </radialGradient>
            <mask
              id={`${id}-m`}
              maskUnits="userSpaceOnUse"
              x={left}
              y={Math.min(sourceY, targetY) - 24}
              width={right - left}
              height={Math.abs(targetY - sourceY) + 48}
            >
              <circle r="15" fill={`url(#${id}-g)`}>
                <animateMotion dur="1s" repeatCount="indefinite" path={path} />
              </circle>
            </mask>
          </defs>
          <path
            d={path}
            stroke="#fff"
            strokeWidth={2}
            fill="none"
            mask={`url(#${id}-m)`}
            pointerEvents="none"
            aria-hidden="true"
          />
        </>
      )}
    </>
  );
});
