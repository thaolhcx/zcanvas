import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Anchored popover. Escape and outside clicks close only the popover; they are stopped
 * so the host (e.g. the canvas) doesn't also deselect the node.
 */
export function Popover({
  trigger,
  children,
  placement = "top",
  align = "start",
  width,
  open: controlled,
  onOpenChange,
  anchorClass = "",
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  placement?: "top" | "bottom";
  align?: "start" | "end";
  width?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Extra class on the anchor, e.g. to position the popover against a wider parent. */
  anchorClass?: string;
}) {
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const setOpen = (v: boolean) =>
    onOpenChange ? onOpenChange(v) : setInner(v);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  });
  const close = () => setOpen(false);
  return (
    <div className={`kit-pop-anchor ${anchorClass}`} ref={ref}>
      {trigger(open, () => setOpen(!open))}
      {open && (
        <div
          className={`kit-pop kit-pop-${placement} kit-pop-${align}`}
          style={width ? { width } : undefined}
          role="dialog"
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
