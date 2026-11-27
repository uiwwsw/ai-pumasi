// Answers come back as Markdown, the way every chat model writes. Render it instead of showing
// the raw marks. Raw HTML is never run: the only tag models commonly emit, <br>, becomes a line
// break, and everything else stays visible as text.
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const BR = "";
type Node = { type: string; value?: string; tagName?: string; children?: Node[] };

/** Swap <br> for a marker, leaving code spans and fenced blocks exactly as written. */
export function markBreaks(text: string): string {
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part, i) => (i % 2 ? part : part.replace(/<br\s*\/?>/gi, BR)))
    .join("");
}

function breaks() {
  const walk = (node: Node) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child) => {
      if (child.type !== "text" || !child.value?.includes(BR)) {
        walk(child);
        return [child];
      }
      return child.value.split(BR).flatMap((value, i) => [
        ...(i ? [{ type: "element", tagName: "br", properties: {}, children: [] } as Node] : []),
        ...(value ? [{ type: "text", value }] : []),
      ]);
    });
  };
  return (tree: Node) => walk(tree);
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[breaks]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          // No remote images: an answer must not make the app fetch arbitrary addresses.
          img: ({ src, alt }) => (
            <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noreferrer noopener">
              {alt || (typeof src === "string" ? src : "")}
            </a>
          ),
          table: ({ children }) => (
            <div className="md-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {markBreaks(text)}
      </ReactMarkdown>
    </div>
  );
}
