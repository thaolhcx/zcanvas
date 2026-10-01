import type { ReactNode, Ref } from "react";
import { LayoutGrid, List, Search, X } from "lucide-react";
/**
 * The wide browser panel shared by Templates and Media (#11): header, source
 * nav, heading with actions, filters, a scrolling content area, an optional
 * details aside and an optional footer.
 */
export function BrowserShell({
  variant = "overlay",
  className = "",
  label,
  icon,
  closeLabel,
  onClose,
  navLabel,
  nav,
  navFooter,
  heading,
  actions,
  filters,
  meta,
  scrollRef,
  children,
  details,
  footer,
}: {
  variant?: "overlay" | "page";
  className?: string;
  label: string;
  icon: ReactNode;
  closeLabel: string;
  onClose: () => void;
  navLabel: string;
  nav: ReactNode;
  navFooter?: ReactNode;
  heading: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  meta?: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  children: ReactNode;
  details?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className={`template-browser-backdrop ${variant} ${className}`}>
      <section
        className="template-browser"
        role="dialog"
        aria-modal={variant === "overlay"}
        aria-label={label}
      >
        <header className="browser-header">
          <h2>
            {icon}
            {label}
          </h2>
          <button
            className="icon-button"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="browser-layout">
          <nav className="browser-nav" aria-label={navLabel}>
            {nav}
            {navFooter && <div className="browser-nav-footer">{navFooter}</div>}
          </nav>
          <div className="browser-content">
            <div className="browser-heading">
              <div className="browser-title">{heading}</div>
              {actions && <div className="browser-actions">{actions}</div>}
            </div>
            {filters && <div className="browser-filters">{filters}</div>}
            {meta && <div className="browser-meta">{meta}</div>}
            <div className="browser-scroll" ref={scrollRef}>
              {children}
            </div>
            {footer && <footer className="browser-footer">{footer}</footer>}
          </div>
          {details}
        </div>
      </section>
    </div>
  );
}
/** One source entry in the shell's nav. */
export function NavButton({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "active" : ""}
      aria-pressed={active}
      onClick={onClick}
    >
      {icon}
      {label}
      {count !== undefined && <span>{count}</span>}
    </button>
  );
}
export function SearchField({
  label,
  placeholder,
  value,
  onChange,
  onKeyDown,
  autoFocus,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="browser-search">
      <Search size={15} />
      <input
        autoFocus={autoFocus}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange("")}>
          <X size={13} />
        </button>
      )}
    </label>
  );
}
export function ViewToggle({
  view,
  onChange,
}: {
  view: "grid" | "list";
  onChange: (view: "grid" | "list") => void;
}) {
  return (
    <div className="view-toggle" role="group" aria-label="View">
      <button
        className={view === "grid" ? "active" : ""}
        aria-label="Grid view"
        aria-pressed={view === "grid"}
        onClick={() => onChange("grid")}
      >
        <LayoutGrid size={15} />
      </button>
      <button
        className={view === "list" ? "active" : ""}
        aria-label="List view"
        aria-pressed={view === "list"}
        onClick={() => onChange("list")}
      >
        <List size={15} />
      </button>
    </div>
  );
}
export function Chips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: { value: T | undefined; label: string }[];
  onChange: (value: T | undefined) => void;
}) {
  return (
    <div className="filter-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value ?? "all"}
          className={value === o.value ? "active" : ""}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
