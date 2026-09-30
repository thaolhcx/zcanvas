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
  // Curve directly from each anchor. Give vertically separated nodes enough
  // horizontal room to turn smoothly instead of folding around a fixed stem.
  const offset = Math.max(
    48,
    Math.abs(targetX - sourceX) / 2,
    Math.min(180, Math.abs(targetY - sourceY) * 0.3),
  );
  const path = `M${sourceX},${sourceY} C${sourceX + offset},${sourceY} ${targetX - offset},${targetY} ${targetX},${targetY}`;
  const left = Math.min(sourceX, targetX - offset) - 24,
    right = Math.max(targetX, sourceX + offset) + 24;
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
