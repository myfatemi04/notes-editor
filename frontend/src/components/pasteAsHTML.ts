import TurndownService from "turndown";
import { gfm } from "@truto/turndown-plugin-gfm";

// Set up one Turndown instance for the page
const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
  hr: "---",
});

// Enable GitHub-flavored Markdown bits (tables, strikethrough, task lists)
turndownService.use(gfm);

// Switch font-style=='italic' to *italic*
turndownService.addRule("switchFontStyle", {
  filter: (node) => node.nodeName === "SPAN",
  replacement: (content, node) => {
    if (node.style["font-style"] == "italic") {
      return `*${content}*`;
    } else if (["bold", "700"].includes(node.style["font-weight"])) {
      return `**${content}**`;
    }
    return content;
  },
});

// Strangely, sometimes <b> is used for non-bold text when pasting from Google Docs.
turndownService.addRule("ignoreNormalWeightBold", {
  filter: (node) => node.nodeName === "B" || node.nodeName === "STRONG",
  replacement: (content, node) => {
    if (["normal", "400"].includes(node.style["font-weight"])) {
      return content;
    }
    return content;
  },
});

// Compute depth of list elements.
turndownService.addRule("listDepth", {
  filter: (node) => node.nodeName === "LI",
  replacement: (content: string, node) => {
    let depth = 0;
    let parent = node.parentNode;
    while (parent) {
      if (parent.nodeName === "UL" || parent.nodeName === "OL") depth++;
      parent = parent.parentNode;
    }
    return "\n" + "  ".repeat(depth - 1) + "- " + content.trim() + "\n";
  },
});

// Disable the whitespace that Turndown adds by default.
turndownService.addRule("ulWhitespace", {
  filter: (node) => node.nodeName === "UL",
  replacement: (content) => content,
});

// Utility: insert text at cursor, preserving selection + undo history
function insertAtCursor(textarea, text) {
  // Update value and selection
  document.execCommand("insertText", false, text);

  // Let frameworks/listeners know content changed
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

function normalizeHtml(html) {
  // Minimal sanitation/normalization for Google Docs paste
  // - Remove style/class attributes
  // - Drop comments & meta cruft
  // double
  html = html.replace("“", '"');
  html = html.replace("”", '"');
  // single
  html = html.replace("‘", "'");
  html = html.replace("’", "'");
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Remove comments
  const walk = document.createTreeWalker(
    doc.body,
    NodeFilter.SHOW_COMMENT,
    null
  );
  let node: Node | null = null;
  while ((node = walk.nextNode())) {
    doc.removeChild(node);
  }

  // Strip noisy attributes
  doc.body.querySelectorAll("*").forEach((el) => {
    // el.removeAttribute("style");
    el.removeAttribute("class");
    el.removeAttribute("id");
    el.removeAttribute("dir");
    el.removeAttribute("data-*");
  });

  // Convert headings that are actually big <span> or <font> into <p> (Turndown handles <p> fine)
  // (Leave real <h1>-<h6> alone.)
  return doc.body.innerHTML;
}

// Attach to all textareas with class "md-paste"
export function getEventListener() {
  function onPaste(e: ClipboardEvent) {
    const target = e.target as HTMLTextAreaElement;

    const cb = e.clipboardData;
    if (!cb) return; // no clipboard (let default happen)

    const html = cb.getData("text/html");
    if (!html) return; // not HTML -> let default paste happen

    e.preventDefault();

    const normalized = normalizeHtml(html);

    console.log("Received HTML:", normalized);

    let md = turndownService.turndown(normalized).trim();

    // Nice-to-haves:
    // - Collapse 3+ blank lines
    md = md.replace(/\n{3,}/g, "\n\n");
    // - Ensure trailing newline if pasting at line start (optional)
    const atLineStart =
      target.selectionStart === 0 ||
      target.value[target.selectionStart - 1] === "\n";
    if (!atLineStart) md = md.replace(/^\n+/, "");

    insertAtCursor(target, md);
  }

  return onPaste;
}
