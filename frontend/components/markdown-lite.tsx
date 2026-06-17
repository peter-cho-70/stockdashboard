"use client";

import { useMemo } from "react";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  return out;
}

type Block =
  | { type: "h3"; text: string }
  | { type: "h2"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "pre"; text: string }
  | { type: "hr" };

function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let inCode = false;
  let codeBuf: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      if (inCode) {
        blocks.push({ type: "pre", text: codeBuf.join("\n") });
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      i += 1;
      continue;
    }

    if (inCode) {
      codeBuf.push(line);
      i += 1;
      continue;
    }

    if (line.trim() === "---") {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    if (line.startsWith("### ")) {
      blocks.push({ type: "h3", text: line.slice(4).trim() });
      i += 1;
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push({ type: "h2", text: line.slice(3).trim() });
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("#") && !/^[-*]\s+/.test(lines[i].trim())) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "p", text: para.join("\n") });
  }

  if (inCode && codeBuf.length) {
    blocks.push({ type: "pre", text: codeBuf.join("\n") });
  }

  return blocks;
}

export function MarkdownLite({ markdown, className = "" }: { markdown: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(markdown || ""), [markdown]);

  if (!markdown?.trim()) {
    return <p className="text-sm text-neutral-400">내용이 없습니다.</p>;
  }

  return (
    <article className={`space-y-3 text-sm text-neutral-700 dark:text-neutral-300 ${className}`}>
      {blocks.map((b, idx) => {
        if (b.type === "h2") {
          return (
            <h2
              key={idx}
              className="text-base font-semibold text-neutral-900 dark:text-neutral-100 pt-2 border-t border-[var(--border-subtle)] first:border-0 first:pt-0"
              dangerouslySetInnerHTML={{ __html: renderInline(b.text) }}
            />
          );
        }
        if (b.type === "h3") {
          return (
            <h3
              key={idx}
              className="text-sm font-semibold text-neutral-800 dark:text-neutral-200"
              dangerouslySetInnerHTML={{ __html: renderInline(b.text) }}
            />
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={idx} className="list-disc pl-5 space-y-1">
              {b.items.map((item, j) => (
                <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
              ))}
            </ul>
          );
        }
        if (b.type === "pre") {
          return (
            <pre
              key={idx}
              className="overflow-x-auto rounded-md bg-neutral-100 dark:bg-neutral-900 p-3 text-xs font-mono whitespace-pre"
            >
              {b.text}
            </pre>
          );
        }
        if (b.type === "hr") {
          return <hr key={idx} className="border-[var(--border-subtle)]" />;
        }
        return (
          <p
            key={idx}
            className="whitespace-pre-wrap leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderInline(b.text) }}
          />
        );
      })}
    </article>
  );
}
