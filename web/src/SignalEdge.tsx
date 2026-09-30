import { memo, useSyncExternalStore } from "react";
import {
  BaseEdge,
  EdgeText,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const subscribe = (notify: () => void) => {
  reducedMotion.addEventListener("change", notify);
  return () => reducedMotion.removeEventListener("change", notify);
};
const getReducedMotion = () => reducedMotion.matches;

export const SignalEdge = memo(function SignalEdge(
  props: EdgeProps<Edge<{ active: boolean }>>,
) {
  const reduced = useSyncExternalStore(subscribe, getReducedMotion);
  const [path, labelX, labelY] = getBezierPath({
    ...props,
    curvature: props.pathOptions?.curvature,
  });
  const { id, sourceX, sourceY, targetX, targetY } = props;
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
      {props.data?.active && !reduced && (
        <>
          <defs>
            <radialGradient id={`${id}-g`}>
              <stop offset="0%" stopColor="#fff" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.01)" />
            </radialGradient>
            <mask
              id={`${id}-m`}
              maskUnits="userSpaceOnUse"
              x={Math.min(sourceX, targetX) - 24}
              y={Math.min(sourceY, targetY) - 24}
              width={Math.abs(targetX - sourceX) + 48}
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
      {props.label && (
        <EdgeText
          x={labelX}
          y={labelY}
          label={props.label}
          labelStyle={props.labelStyle}
          labelShowBg={props.labelShowBg}
          labelBgStyle={props.labelBgStyle}
          labelBgPadding={props.labelBgPadding}
          labelBgBorderRadius={props.labelBgBorderRadius}
        />
      )}
    </>
  );
});
