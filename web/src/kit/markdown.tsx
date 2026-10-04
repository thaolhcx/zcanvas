// Small GFM subset renderer for text results and sticky notes: headings, bold, italic,
// inline code, links, lists, task lists (clickable), quotes, code blocks and tables.
import { Fragment, type ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|_[^_]+_|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0,
    m: RegExpExecArray | null,
    i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0],
      k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!;
      out.push(
        <a key={k} href={href} target="_blank" rel="noreferrer">
          {label}
        </a>,
      );
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({
  text,
  onToggleTask,
}: {
  text: string;
  /** Called with the source line index of a task checkbox. */
  onToggleTask?: (line: number) => void;
}) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```"))
        body.push(lines[i++]);
      i++;
      blocks.push(<pre key={i}>{body.join("\n")}</pre>);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)/.exec(line);
    if (h) {
      const Tag = `h${h[1].length + 2}` as "h3";
      blocks.push(<Tag key={i}>{inline(h[2], `h${i}`)}</Tag>);
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      blocks.push(
        <blockquote key={i}>
          {inline(line.replace(/^>\s?/, ""), `q${i}`)}
        </blockquote>,
      );
      i++;
      continue;
    }
    if (line.includes("|") && lines[i + 1]?.match(/^\s*\|?\s*-{2,}/)) {
      const cells = (l: string) =>
        l
          .replace(/^\s*\||\|\s*$/g, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|"))
        rows.push(cells(lines[i++]));
      blocks.push(
        <table key={i}>
          <thead>
            <tr>
              {head.map((c, k) => (
                <th key={k}>{inline(c, `th${k}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, k) => (
                  <td key={k}>{inline(c, `td${ri}${k}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const raw = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "");
        const task = /^\[( |x)\]\s*(.*)/i.exec(raw);
        const at = i;
        items.push(
          <li key={i} className={task ? "task" : undefined}>
            {task ? (
              <label>
                <input
                  type="checkbox"
                  checked={task[1].toLowerCase() === "x"}
                  onChange={() => onToggleTask?.(at)}
                  disabled={!onToggleTask}
                />
                <span>{inline(task[2], `t${i}`)}</span>
              </label>
            ) : (
              inline(raw, `l${i}`)
            )}
          </li>,
        );
        i++;
      }
      blocks.push(
        ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    blocks.push(<p key={i}>{inline(line, `p${i}`)}</p>);
    i++;
  }
  return (
    <div className="kit-md">
      {blocks.map((b, k) => (
        <Fragment key={k}>{b}</Fragment>
      ))}
    </div>
  );
}

/** Flip "[ ]" ↔ "[x]" on one line. */
export function toggleTask(text: string, line: number) {
  const lines = text.split("\n");
  lines[line] = lines[line].replace(/\[( |x)\]/i, (m) =>
    m === "[ ]" ? "[x]" : "[ ]",
  );
  return lines.join("\n");
}
