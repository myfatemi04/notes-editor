import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { getEventListener } from "./pasteAsHTML";
import { createFile, createProcessor, post } from "./rmd-modified";
import Canvas, { CanvasHostContext } from "./Canvas";

const processor = createProcessor({
  remarkPlugins: [remarkMath, remarkGfm],
  rehypePlugins: [rehypeKatex],
});

const EMPTY_SPECIAL_STRING = "(empty)";
const TAB_SIZE = 4;
const CANVAS_URL_BASE = "data:image/minicanvas;base64,";

function logEvent(tag: string, metadata: Record<string, any> = {}) {
  console.log(`event: ${tag}`, metadata);
}

function Block({
  editing,
  editMe,
  editPrevious,
  editNext,
  initialCursorPosition,
  ast,
  content,
  setContent,
  mdopts,
  undo,
  mergePrevious,
  split,
  file,
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const blockType = content.startsWith("```")
    ? "code"
    : content.startsWith("$$")
    ? "math"
    : ast.type === "paragraph" &&
      ast.children.length === 1 &&
      ast.children[0].type === "image" &&
      ast.children[0].url.startsWith(CANVAS_URL_BASE)
    ? "canvas"
    : "text";

  console.log(ast);

  const textareaContent =
    content === EMPTY_SPECIAL_STRING
      ? ""
      : blockType === "code"
      ? // Skip the language declaration and unescape backticks.
        content
          .slice(content.indexOf("\n") + 1, content.lastIndexOf("\n```"))
          .replace(/\\`/g, "`")
      : blockType === "math"
      ? // Math blocks are required to have '\n' after '$$' at start and before '$$' at end.
        content.slice("$$\n".length, content.length - "\n$$".length)
      : blockType === "canvas"
      ? ast.children[0].url.slice(CANVAS_URL_BASE.length)
      : content;

  const setFromTextareaContent = useCallback(
    (textareaContent: string) => {
      if (blockType === "code") {
        const firstLine = content.slice(0, content.indexOf("\n"));
        const newContent = `${firstLine}\n${textareaContent.replace(
          /`/g,
          "\\`"
        )}\n\`\`\``;
        logEvent("edit-block-code", { textareaContent, newContent });
        setContent(newContent);
        return;
      }
      if (blockType === "canvas") {
        // Canvas can set b64 content to '' to remove itself.
        if (textareaContent.length === 0) {
          logEvent("remove-canvas-block");
          setContent("");
        } else {
          setContent(`![@canvas](${CANVAS_URL_BASE + textareaContent})`);
        }
        return;
      }
      if (blockType === "math") {
        setContent(`$$\n${textareaContent}\n$$`);
        return;
      }
      setContent(textareaContent || EMPTY_SPECIAL_STRING);

      logEvent("edit-block", { value: textareaContent });
    },
    [blockType, setContent]
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const keyListener = (e: KeyboardEvent) => {
      // Handle undos.
      const isUndo = e.key === "z" && (e.metaKey || e.ctrlKey);
      if (isUndo) {
        e.preventDefault();
        undo();
      }

      const isTextSelected = textarea.selectionStart !== textarea.selectionEnd;
      if (isTextSelected) {
        return;
      }
      const cursor = textarea.selectionStart;
      const firstLineEnd = textarea.value.indexOf("\n");
      const lastLineStart = textarea.value.lastIndexOf("\n") + 1;

      // Pressing arrow keys on first or last lines should move to previous/next block
      if (
        e.key === "ArrowUp" &&
        // (firstLineEnd === -1 || cursor < firstLineEnd)
        cursor === 0
      ) {
        e.preventDefault();
        editPrevious();
        logEvent("edit-previous-arrowup", { cursor, firstLineEnd });
        return;
      }

      if (
        e.key === "ArrowDown" &&
        // (lastLineStart === 0 || cursor > lastLineStart)
        cursor === textarea.value.length
      ) {
        e.preventDefault();
        editNext();
        logEvent("edit-next-arrowdown", { cursor, lastLineStart });
        return;
      }

      // Pressing left/right at beginning/end of text should move to previous/next block
      if (e.key === "ArrowLeft" && cursor === 0) {
        e.preventDefault();
        editPrevious();
        logEvent("edit-previous-arrowleft", { cursor });
        return;
      }

      if (e.key === "ArrowRight" && cursor === textarea.value.length) {
        e.preventDefault();
        editNext();
        logEvent("edit-next-arrowright", { cursor });
        return;
      }

      const currentLineStart = textarea.value.lastIndexOf("\n", cursor - 1) + 1;
      const currentLineEnd = textarea.value.indexOf("\n", cursor);
      const currentLine =
        currentLineEnd === -1
          ? textarea.value.slice(currentLineStart)
          : textarea.value.slice(currentLineStart, currentLineEnd);

      // Pressing Enter in a block should create a new block below, with the content of the current block split at the cursor.
      if (e.key === "Enter") {
        // Check if a math or code block, in which case we shouldn't split.
        if (blockType !== "text") {
          if (!e.shiftKey) {
            return;
          }

          // If shift key was held, split from the end of the block.
          e.preventDefault();

          split(content.length);
          logEvent("split-non-text-block", { cursor });
          return;
        }

        e.preventDefault();

        // Check if an unordered list item.
        if (currentLine.trimStart().startsWith("- ")) {
          // If the current line is a (non-empty) list item, pressing Enter should add another list item after this line.
          const indentation = currentLine.indexOf("- ");

          if (currentLine.slice(indentation + 2).trim() === "") {
            // Line is an empty list item.
            split(cursor);
            logEvent("split-empty-unordered-list-item", { cursor });
            return;
          }

          const newListItemPrefix = "\n" + " ".repeat(indentation) + "- ";
          const before = textarea.value.slice(0, cursor);
          const after = textarea.value.slice(cursor);
          const newContent = before + newListItemPrefix + after;
          setContent(newContent);
          logEvent("insert-unordered-list-item", {
            cursor,
            before,
            newListItemPrefix,
            after,
          });
          setTimeout(() => {
            textarea.selectionStart = (before + newListItemPrefix).length;
            textarea.selectionEnd = textarea.selectionStart;
            textarea.focus();
          }, 0);
          return;
        }

        // Check if a numbered list item.
        const numberedListMatch = currentLine.trimStart().match(/^(\d+)\. /);
        if (numberedListMatch) {
          const indentation = currentLine.indexOf(numberedListMatch[0]);
          const number = parseInt(numberedListMatch[1], 10);
          if (
            currentLine
              .slice(indentation + numberedListMatch[0].length)
              .trim() === ""
          ) {
            // Line is an empty list item.
            split(cursor);
            logEvent("split-empty-numbered-list-item", { cursor });
            return;
          }

          const newListItemPrefix =
            "\n" + " ".repeat(indentation) + (number + 1) + ". ";
          const before = textarea.value.slice(0, cursor);
          const after = textarea.value.slice(cursor);
          const newContent = before + newListItemPrefix + after;
          setContent(newContent);
          logEvent("insert-numbered-list-item", {
            cursor,
            before,
            newListItemPrefix,
            after,
          });
          setTimeout(() => {
            textarea.selectionStart = (before + newListItemPrefix).length;
            textarea.selectionEnd = textarea.selectionStart;
            textarea.focus();
          }, 0);
          return;
        }

        split(cursor);
        logEvent("split", { cursor });
        return;
      }

      // Pressing Backspace at the beginning of a block should merge with the previous block.
      if (e.key === "Backspace" && cursor === 0) {
        // Don't merge with previous block if code or math block.
        if (blockType !== "text") {
          // Remove block if empty.
          if (textareaContent === "") {
            setContent("");
            logEvent("remove-empty-non-text-block");
          }
          return;
        }

        e.preventDefault();
        mergePrevious();
        logEvent("merge-previous");
        return;
      }

      // If the current line is just a list item marker, remove it.
      if (
        e.key === "Backspace" &&
        (currentLine.trim() === "-" || currentLine.trim().match(/^\d+\. /))
      ) {
        e.preventDefault();
        const before = textarea.value.slice(0, currentLineStart);
        const after =
          currentLineEnd === -1 ? "" : textarea.value.slice(currentLineEnd + 1);
        const newContent = before + after;
        setContent(newContent);
        logEvent("remove-list-item-marker", { cursor, before, after });
        setTimeout(() => {
          textarea.selectionStart = before.length - 1;
          textarea.selectionEnd = textarea.selectionStart;
          textarea.focus();
        }, 0);
      }

      if (e.key === "Tab") {
        e.preventDefault();

        // Allow tabbing in LaTeX or code blocks. If shift key is held, unindent will be done instead.
        if (blockType !== "text" && !e.shiftKey) {
          document.execCommand("insertText", false, " ".repeat(TAB_SIZE));
          return;
        }

        // Check if on a line with a list item.
        const lineStart = textarea.value.lastIndexOf("\n", cursor - 1) + 1;
        const lineEnd = textarea.value.indexOf("\n", cursor);
        const line =
          lineEnd === -1
            ? textarea.value.slice(lineStart)
            : textarea.value.slice(lineStart, lineEnd);

        // Unindent logic.
        if (e.shiftKey) {
          let newLine = line;
          let cursorAdjustment = 0;
          for (let i = TAB_SIZE; i > 0; i--) {
            if (line.startsWith(" ".repeat(i))) {
              newLine = line.slice(i);
              cursorAdjustment = -i;
              break;
            }
          }

          if (newLine !== line) {
            const before = textarea.value.slice(0, lineStart);
            const after = lineEnd === -1 ? "" : textarea.value.slice(lineEnd);
            const newContent = before + newLine + after;
            setFromTextareaContent(newContent);
            logEvent("unindent-line", { cursor, before, newLine, after });
            setTimeout(() => {
              textarea.selectionStart = cursor + cursorAdjustment;
              textarea.selectionEnd = cursor + cursorAdjustment;
              textarea.focus();
            }, 0);
          }

          return;
        }

        if (
          line.trimStart().startsWith("- ") ||
          line.trimStart().match(/^\d+\. /)
        ) {
          // Increase indentation of list item.
          const before = textarea.value.slice(0, lineStart);
          const after = lineEnd === -1 ? "" : textarea.value.slice(lineEnd);

          let newLine: string;
          if (line.trimStart().match(/^(\d+)\. /)) {
            // Numbered list item; the number should reset to 1.
            const indentation = " ".repeat(
              line.length - line.trimStart().length + TAB_SIZE
            );
            const contentStart = line.indexOf(".") + 1;
            newLine = `${indentation}1. ${line
              .slice(contentStart)
              .trimStart()}`;
          } else {
            // Unordered list item.
            newLine = " ".repeat(TAB_SIZE) + line;
          }
          const newContent = before + newLine + after;
          setContent(newContent);
          logEvent("indent-list-item", { cursor, before, newLine, after });

          setTimeout(() => {
            textarea.selectionStart = cursor + TAB_SIZE;
            textarea.selectionEnd = cursor + TAB_SIZE;
            textarea.focus();
          }, 0);
          return;
        }

        document.execCommand("insertText", false, "  ");
        return;
      }
    };

    const pasteListener = getEventListener();
    textarea.addEventListener("paste", pasteListener);
    textarea.addEventListener("keydown", keyListener);

    return () => {
      textarea.removeEventListener("keydown", keyListener);
      textarea.removeEventListener("paste", pasteListener);
    };
  }, [editing, undo, blockType]);

  const onChange = useCallback(() => {
    const textarea = textareaRef.current!;

    if (blockType === "text") {
      // Create math blocks.
      if (
        (textarea.value.endsWith("$$") && !textarea.value.startsWith("$$")) ||
        textarea.value === "$$"
      ) {
        logEvent("create-math-block");
        setContent(textarea.value + "\n\n$$\n\n");
        return;
      }

      // Create code blocks.
      if (
        (textarea.value.endsWith("```") && !textarea.value.startsWith("```")) ||
        textarea.value === "```"
      ) {
        logEvent("create-code-block");
        setContent(textarea.value + "\n\n```\n\n");
        return;
      }

      // Create canvas blocks.
      console.log({
        endsWithCanvas: textarea.value.endsWith("/canvas"),
        value: textarea.value,
      });
      if (textarea.value.endsWith("/canvas")) {
        logEvent("create-canvas-block");
        setContent(
          textarea.value.slice(0, -"/canvas".length) +
            `\n\n![@canvas](${CANVAS_URL_BASE})\n\n`
        );
        return;
      }
    }

    setFromTextareaContent(textarea.value);
  }, [blockType, content, setContent]);

  if (textareaRef.current) {
    const textarea = textareaRef.current;
    textarea.style.height = "";
  }

  useEffect(() => {
    // This should only apply in the beginning.
    if (editing && textareaRef.current) {
      if (initialCursorPosition < 0) {
        initialCursorPosition =
          textareaContent.length + initialCursorPosition + 1;
      }

      textareaRef.current.selectionStart = initialCursorPosition;
      textareaRef.current.selectionEnd = initialCursorPosition;
      textareaRef.current.focus();
    }
  }, [editing]);

  const setCodeLang = useCallback((newLang: string) => {
    const textarea = textareaRef.current!;
    const newContent = `\`\`\`${newLang}\n${textarea.value}\`\`\``;
    console.log({ newContent });
    setContent(newContent);
  }, []);

  const maxWidth = !editing ? "600px" : "1200px";

  const language =
    blockType === "code"
      ? content.slice(0, content.indexOf("\n")).slice("```".length).trim()
      : null;

  return (
    <div
      style={{
        borderBottom: "1px solid red",
        paddingLeft: `calc(max((100% - ${maxWidth}) / 2, 12px))`,
        paddingRight: `calc(max((100% - ${maxWidth}) / 2, 12px))`,
        paddingTop: "4px",
        paddingBottom: "4px",
        display: "flex",
        alignItems: "center",
        minHeight: "10px",
      }}
      onClick={() => !editing && editMe()}
    >
      {blockType === "canvas" ? (
        <CanvasHostContext.Provider
          value={{
            setB64: setFromTextareaContent,
            b64: textareaContent,
            editing,
          }}
        >
          <Canvas />
        </CanvasHostContext.Provider>
      ) : (
        <>
          <div style={{ flex: 1, display: editing ? "block" : "none" }}>
            {/* Mutually exclusive. */}
            {blockType !== "text" && `(${blockType})`}
            {blockType === "code" &&
              (() => {
                // Try to extract language from first line.
                const firstLine = content.slice(0, content.indexOf("\n"));
                const lang = firstLine.slice("```".length).trim();
                return (
                  <select
                    className="language-select-for-block"
                    value={lang}
                    onChange={(e) => setCodeLang(e.target.value)}
                  >
                    <option value="">Select language...</option>
                    <option value="text">Text</option>
                    <option value="dag">DAG</option>
                    <option value="canvas">Canvas</option>
                  </select>
                );
              })()}
            <textarea
              className="textarea-for-block"
              value={textareaContent}
              onChange={onChange}
              ref={textareaRef}
            />
          </div>
          <div
            style={{ flex: 1, marginLeft: "12px", fontFamily: "sans-serif" }}
          >
            {post(
              processor.runSync({ type: "root", children: [ast] }, file),
              mdopts
            )}
          </div>
        </>
      )}
    </div>
  );
}

function normalize(content, ast) {
  const children = ast.children.filter((child) => !!child.position);
  const blockTexts: string[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const start = child.position!.start.offset!;
    const end =
      i < children.length - 1
        ? children[i + 1].position!.start.offset!
        : content.length + 1;
    let blockValue = content.slice(start, end);

    // Count number of newlines at end
    let newlineCount = 0;
    for (let j = blockValue.length - 1; j >= 0; j--) {
      if (blockValue[j] === "\n") {
        newlineCount += 1;
      } else {
        break;
      }
    }

    blockTexts.push(blockValue);

    while (newlineCount < 2) {
      blockTexts[i] += "\n";
      newlineCount += 1;
    }
    while (newlineCount > 2) {
      blockTexts[i] = blockTexts[i].slice(0, -1);
      newlineCount -= 1;
    }
  }
  return blockTexts.join("") || `${EMPTY_SPECIAL_STRING}\n\n`;
}

export default function BlockEditor({
  content,
  setContent,
  allowedElements,
  allowElement,
  components,
  disallowedElements,
  skipHtml,
  unwrapDisallowed,
  urlTransform,
  disabled = false,
}: {
  content: string;
  setContent: (content: string) => void;
  allowedElements?: string[] | undefined;
  allowElement?: ((element: any) => boolean) | undefined;
  components?: Record<string, unknown> | undefined;
  disallowedElements?: string[] | undefined;
  skipHtml?: boolean | undefined;
  unwrapDisallowed?: boolean | undefined;
  urlTransform?: ((url: string) => string) | undefined;
  disabled?: boolean;
}) {
  // Parse the content into top-level content, which we will use for blocks.
  const file = useMemo(() => createFile({ children: content }), [content]);
  const tree = useMemo(() => processor.parse(file), [file]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const children = tree.children.filter((child) => !!child.position);
  const previousValuesRef = useRef<string[]>([]);
  const nextInitialCursorPositionRef = useRef<number>(0);

  const normalized = useMemo(() => normalize(content, tree), [content, tree]);

  if (content !== normalized) {
    content = normalized;
    // Must be done asynchronously so that parent component finishes rendering first.
    setTimeout(() => {
      logEvent("normalize", { normalized });
      setContent(normalized);
    }, 0);
  }

  useEffect(() => {
    if (content == previousValuesRef.current.at(-1)) {
      return;
    }

    if (previousValuesRef.current.length > 5) {
      previousValuesRef.current.shift();
    }
    previousValuesRef.current.push(content);
  }, [content]);

  const undo = () => {
    if (previousValuesRef.current.length < 2) {
      return;
    }
    previousValuesRef.current.pop();
    const previous = previousValuesRef.current.at(-1);
    if (previous !== undefined) {
      setContent(previous);
    }
  };

  const mdopts = {
    allowedElements,
    allowElement,
    components,
    disallowedElements,
    skipHtml,
    unwrapDisallowed,
    urlTransform,
  };

  return (
    <div style={{ overflowY: "auto" }}>
      {children.map((child, i) => {
        const start = child.position!.start.offset!;
        const end =
          i < children.length - 1
            ? children[i + 1].position!.start.offset!
            : content.length + 1;

        // Delimiter is two newlines.
        const blockContentIncludingDelimiter = content.slice(start, end);
        const blockContent = blockContentIncludingDelimiter.slice(0, -2);

        const setBlockContent = (newBlockContentWithoutDelimiter: string) => {
          const beforeThisBlock = content.slice(0, start);
          const afterThisBlock = content.slice(end);
          const newBlockContent = newBlockContentWithoutDelimiter + "\n\n";
          const newDocumentContent = `${beforeThisBlock}${newBlockContent}${afterThisBlock}`;

          setContent(newDocumentContent);

          if (newBlockContent.trim() === "" && i > 0) {
            setEditingIndex(i - 1);
            nextInitialCursorPositionRef.current = -1;
          }
        };

        const mergePrevious = () => {
          if (i === 0) {
            logEvent("merge-previous-noop-at-start");
            return;
          }
          const previousChild = children[i - 1];
          const previousStart = previousChild.position!.start.offset!;
          const previousEnd = start;
          const previousChildContentIncludingDelimiter = content.slice(
            previousStart,
            previousEnd
          );

          // Handles EMPTY_SPECIAL_STRING on nextInitialCursorPositionRef.
          let previousChildContent =
            previousChildContentIncludingDelimiter.slice(0, -2);
          if (previousChildContent === EMPTY_SPECIAL_STRING) {
            previousChildContent = "";
          }

          const previousChildContentUpdated =
            previousChildContent +
              (blockContent !== EMPTY_SPECIAL_STRING ? blockContent : "") ||
            EMPTY_SPECIAL_STRING;

          const beforePreviousBlock = content.slice(0, previousStart);
          const afterThisBlock = content.slice(end);
          const newDocumentContent = `${beforePreviousBlock}${previousChildContentUpdated}\n\n${afterThisBlock}`;
          setContent(newDocumentContent);
          setEditingIndex(i - 1);
          nextInitialCursorPositionRef.current = previousChildContent.length;
        };

        const split = (at: number) => {
          // This function should only be called on text blocks.
          const effectiveContent =
            blockContent === EMPTY_SPECIAL_STRING ? "" : blockContent;
          const before = effectiveContent.slice(0, at) || EMPTY_SPECIAL_STRING;
          const after = effectiveContent.slice(at) || EMPTY_SPECIAL_STRING;

          const beforeWithDelimiter = before + "\n\n";
          const afterWithDelimiter = `${
            after.trim() ? after : EMPTY_SPECIAL_STRING
          }\n\n`;

          console.log({ before, after });

          const beforeThisBlock = content.slice(0, start);
          const afterThisBlock = content.slice(end);
          const newDocumentContent = `${beforeThisBlock}${beforeWithDelimiter}${afterWithDelimiter}${afterThisBlock}`;
          setContent(newDocumentContent);
          setEditingIndex(i + 1);
          nextInitialCursorPositionRef.current = 0;
        };

        return (
          <Block
            key={i}
            undo={undo}
            editing={editingIndex === i}
            ast={child}
            mdopts={mdopts}
            setContent={setBlockContent}
            editMe={() => {
              setEditingIndex(i);
              nextInitialCursorPositionRef.current = 0;
            }}
            editPrevious={() => {
              if (i > 0) {
                setEditingIndex(i - 1);
                nextInitialCursorPositionRef.current = -1;
              }
            }}
            editNext={() => {
              if (i < children.length - 1) {
                setEditingIndex(i + 1);
                nextInitialCursorPositionRef.current = 0;
              }
            }}
            initialCursorPosition={nextInitialCursorPositionRef.current}
            content={blockContent}
            mergePrevious={mergePrevious}
            split={split}
            file={file}
          />
        );
      })}
      <button
        onClick={() => setContent(content + "\n\n(empty)\n\n")}
        className="button"
        style={{ marginLeft: "12px", marginTop: "12px", border: 0 }}
      >
        Add block
      </button>
      <div style={{ height: "100vh" }} onClick={() => setEditingIndex(null)} />
    </div>
  );
}
