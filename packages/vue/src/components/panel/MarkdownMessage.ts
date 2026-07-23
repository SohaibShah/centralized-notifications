import { defineComponent, h, type PropType, type VNode } from "vue";
import { marked, type Token, type Tokens } from "marked";
import type { ChatSource } from "@notifications/shared";
import CitationChip from "./CitationChip.vue";

// Render an AI answer as markdown WITHOUT v-html: marked tokenizes, and we map tokens to VNodes we
// construct ourselves. Nothing from the model is ever injected as raw HTML (raw `html` tokens are
// dropped), so this keeps the module's "no v-html" property while still formatting the model's
// markdown (bold, lists, headings, code, links). Inline `[n#]` citations are split out of the text
// and rendered as the interactive CitationChip component, exactly as before.

type Sources = Record<string, ChatSource>;

// One bracket holding one-or-more n-refs: [n1] or [n1, n2, n3]. Kept in sync with the server's
// citation format (see the chat prompt) — the same pattern the old inline renderer used.
const CITATION_SPLIT = /(\[n\d+(?:\s*,\s*n\d+)*\])/;
const CITATION_FULL = /^\[n\d+(?:\s*,\s*n\d+)*\]$/;

// Split a run of plain text into text + citation-chip VNodes. A group whose refs are all unknown for
// this turn stays as literal text (matches the pre-markdown behavior).
function renderText(raw: string, sources: Sources): (VNode | string)[] {
  return raw
    .split(CITATION_SPLIT)
    .filter((s) => s !== "")
    .flatMap<VNode | string>((s) => {
      if (!CITATION_FULL.test(s)) return [s];
      const known = (s.match(/n\d+/g) ?? []).filter((r) => sources[r]);
      if (known.length === 0) return [s];
      return known.map((r) => h(CitationChip, { key: r, source: sources[r]!, class: "mr-1" }));
    });
}

// Strip the surrounding backticks (and one optional padding space) off an inline code span so we set
// the DECODED source as textContent — marked's `.text` is HTML-escaped, which would double-escape.
function codespanText(raw: string): string {
  return raw.replace(/^`+[ ]?/, "").replace(/[ ]?`+$/, "");
}

// Only render hrefs we trust; anything else (javascript:, data:) renders as plain text, no anchor.
function safeHref(href: string): string | undefined {
  try {
    const u = new URL(href, "https://x.invalid");
    if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:") return href;
  } catch {
    /* not a URL */
  }
  return undefined;
}

function inline(tokens: Token[] | undefined, sources: Sources): (VNode | string)[] {
  if (!tokens) return [];
  return tokens.flatMap<VNode | string>((t) => {
    switch (t.type) {
      case "text": {
        const tk = t as Tokens.Text;
        return tk.tokens?.length ? inline(tk.tokens, sources) : renderText(tk.raw, sources);
      }
      case "escape":
        return [(t as Tokens.Escape).text];
      case "strong":
        return [
          h("strong", { class: "font-semibold" }, inline((t as Tokens.Strong).tokens, sources)),
        ];
      case "em":
        return [h("em", { class: "italic" }, inline((t as Tokens.Em).tokens, sources))];
      case "del":
        return [h("del", inline((t as Tokens.Del).tokens, sources))];
      case "codespan":
        return [
          h(
            "code",
            { class: "rounded bg-sunken px-1 py-0.5 font-mono text-[12px]" },
            codespanText((t as Tokens.Codespan).raw),
          ),
        ];
      case "br":
        return [h("br")];
      case "link": {
        const lk = t as Tokens.Link;
        const href = safeHref(lk.href);
        const kids = inline(lk.tokens, sources);
        return href
          ? [
              h(
                "a",
                {
                  href,
                  target: "_blank",
                  rel: "noopener noreferrer nofollow",
                  class: "text-accent underline underline-offset-2",
                },
                kids,
              ),
            ]
          : kids;
      }
      case "image":
        // Don't fetch remote images from model output; show the alt text instead.
        return [(t as Tokens.Image).text];
      default: {
        const anyT = t as { raw?: string; text?: string };
        return renderText(anyT.raw ?? anyT.text ?? "", sources);
      }
    }
  });
}

function listItem(item: Tokens.ListItem, sources: Sources): VNode {
  const kids = item.tokens.flatMap<VNode | string>((tok) => {
    if (tok.type === "text") {
      const tt = tok as Tokens.Text;
      return tt.tokens?.length ? inline(tt.tokens, sources) : renderText(tt.raw, sources);
    }
    return block([tok], sources);
  });
  return h("li", { class: "leading-relaxed" }, kids);
}

function block(tokens: Token[], sources: Sources): VNode[] {
  const out: VNode[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "paragraph":
        out.push(
          h("p", { class: "leading-relaxed" }, inline((t as Tokens.Paragraph).tokens, sources)),
        );
        break;
      case "heading": {
        const ht = t as Tokens.Heading;
        // Clamp to a small range — chat bubbles shouldn't sprout page-sized headings.
        const tag = ht.depth <= 2 ? "h4" : ht.depth === 3 ? "h5" : "h6";
        out.push(h(tag, { class: "font-semibold text-text" }, inline(ht.tokens, sources)));
        break;
      }
      case "list": {
        const lt = t as Tokens.List;
        out.push(
          h(
            lt.ordered ? "ol" : "ul",
            { class: `${lt.ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5` },
            lt.items.map((it) => listItem(it, sources)),
          ),
        );
        break;
      }
      case "code":
        out.push(
          h("pre", { class: "overflow-x-auto rounded-md bg-sunken p-2" }, [
            h("code", { class: "font-mono text-[12px]" }, (t as Tokens.Code).text),
          ]),
        );
        break;
      case "blockquote":
        out.push(
          h(
            "blockquote",
            { class: "border-l-2 border-line-strong pl-2 text-muted" },
            block((t as Tokens.Blockquote).tokens, sources),
          ),
        );
        break;
      case "hr":
        out.push(h("hr", { class: "border-line" }));
        break;
      case "space":
      case "html":
        break;
      case "text": {
        const tt = t as Tokens.Text;
        out.push(
          h(
            "p",
            { class: "leading-relaxed" },
            tt.tokens?.length ? inline(tt.tokens, sources) : renderText(tt.raw, sources),
          ),
        );
        break;
      }
      default: {
        const anyT = t as { raw?: string };
        if (anyT.raw) out.push(h("p", { class: "leading-relaxed" }, renderText(anyT.raw, sources)));
      }
    }
  }
  return out;
}

export default defineComponent({
  name: "MarkdownMessage",
  props: {
    text: { type: String, required: true },
    sources: { type: Object as PropType<Sources>, default: () => ({}) },
  },
  setup(props) {
    return () => {
      const tokens = marked.lexer(props.text, { gfm: true, breaks: true });
      return h(
        "div",
        { class: "space-y-2", "data-test": "ai-markdown" },
        block(tokens as Token[], props.sources),
      );
    };
  },
});
