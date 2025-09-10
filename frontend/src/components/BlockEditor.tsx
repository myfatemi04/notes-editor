import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { getEventListener } from "./pasteAsHTML";
import { createFile, createProcessor, post } from "./rmd-modified";

const processor = createProcessor({
  remarkPlugins: [remarkMath, remarkGfm],
  rehypePlugins: [rehypeKatex],
});

const EMPTY_SPECIAL_STRING = "(empty)";

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
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const blockType = content.startsWith("```")
    ? "code"
    : content.startsWith("$$")
    ? "math"
    : "text";

  const textareaContent =
    content === EMPTY_SPECIAL_STRING
      ? ""
      : blockType === "code"
      ? content.slice(content.indexOf("\n") + 1, content.lastIndexOf("```"))
      : blockType === "math"
      ? // Math blocks are required to have '\n' after '$$' at start and before '$$' at end.
        content.slice("$$\n".length, content.length - "\n$$".length)
      : content;

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
        (firstLineEnd === -1 || cursor < firstLineEnd)
      ) {
        e.preventDefault();
        editPrevious();
        logEvent("edit-previous-arrowup", { cursor, firstLineEnd });
        return;
      }

      if (
        e.key === "ArrowDown" &&
        (lastLineStart === 0 || cursor > lastLineStart)
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

      // Pressing Enter in a block should create a new block below, with the content of the current block split at the cursor.
      if (e.key === "Enter") {
        // Check if a math or code block, in which case we shouldn't split.
        if (content.startsWith("$$")) {
          return;
        }
        if (content.startsWith("```")) {
          return;
        }

        e.preventDefault();
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

    if (blockType === "code") {
      const firstLine = content.slice(0, content.indexOf("\n"));
      setContent(`${firstLine}\n${textarea.value}\n\`\`\``);
      logEvent("edit-code-block");
      return;
    }
    if (blockType === "math") {
      setContent(`$$\n${textarea.value}\n$$`);
      logEvent("edit-math-block");
      return;
    }

    logEvent("edit-text-block");
    setContent(textarea.value);
  }, [blockType, content]);

  if (textareaRef.current) {
    const textarea = textareaRef.current;
    textarea.style.height = "auto";
  }

  useEffect(() => {
    // This should only apply in the beginning.
    if (editing && textareaRef.current) {
      textareaRef.current.selectionStart = initialCursorPosition;
      textareaRef.current.selectionEnd = initialCursorPosition;
    }
  }, [editing]);

  return (
    <div
      style={{
        borderBottom: "1px solid red",
        padding: "12px",
        display: "flex",
        alignItems: "center",
        minHeight: "10px",
      }}
      onClick={() => !editing && editMe()}
    >
      <div style={{ flex: 1, display: editing ? "block" : "none" }}>
        {/* Mutually exclusive. */}
        {blockType !== "text" && `(${blockType})`}
        <textarea
          className="textarea-for-block"
          value={textareaContent}
          onChange={onChange}
          ref={textareaRef}
        />
      </div>
      <div style={{ flex: 1, marginLeft: "12px" }}>
        {post(processor.runSync({ type: "root", children: [ast] }), mdopts)}
      </div>
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
  allowedElements = undefined,
  allowElement = undefined,
  components = undefined,
  disallowedElements = undefined,
  skipHtml = undefined,
  unwrapDisallowed = undefined,
  urlTransform = undefined,
  disabled = false,
}) {
  // Parse the content into top-level content, which we will use for blocks.
  const file = useMemo(() => createFile({ children: content }), [content]);
  const tree = useMemo(() => processor.parse(file), [file]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const children = tree.children.filter((child) => !!child.position);
  const previousValuesRef = useRef<string[]>([]);

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
          setContent(`${beforeThisBlock}${newBlockContent}${afterThisBlock}`);

          if (newBlockContent.trim() === "" && i > 0) {
            setEditingIndex(i - 1);
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
          const previousChildContent =
            previousChildContentIncludingDelimiter.slice(0, -2);
          const previousChildContentUpdated =
            previousChildContent +
            (blockContent !== EMPTY_SPECIAL_STRING ? blockContent : "");

          const beforePreviousBlock = content.slice(0, previousStart);
          const afterThisBlock = content.slice(end);
          const newDocumentContent = `${beforePreviousBlock}${previousChildContentUpdated}\n\n${afterThisBlock}`;
          setContent(newDocumentContent);
          setEditingIndex(i - 1);
        };

        const split = (at: number) => {
          const before = blockContent.slice(0, at);
          const after = blockContent.slice(at);
          const beforeWithDelimiter = before + "\n\n";
          const afterWithDelimiter = `${
            after.trim() ? after : EMPTY_SPECIAL_STRING
          }\n\n`;

          const beforeThisBlock = content.slice(0, start);
          const afterThisBlock = content.slice(end);
          const newDocumentContent = `${beforeThisBlock}${beforeWithDelimiter}${afterWithDelimiter}${afterThisBlock}`;
          setContent(newDocumentContent);
          setEditingIndex(i + 1);
        };

        return (
          <Block
            key={i}
            undo={undo}
            editing={editingIndex === i}
            ast={child}
            mdopts={mdopts}
            setContent={setBlockContent}
            editMe={() => setEditingIndex(i)}
            editPrevious={() => {
              if (i > 0) {
                setEditingIndex(i - 1);
              }
            }}
            editNext={() => {
              if (i < children.length - 1) {
                setEditingIndex(i + 1);
              }
            }}
            initialCursorPosition={0}
            content={blockContent}
            mergePrevious={mergePrevious}
            split={split}
          />
        );
      })}
    </div>
  );
}
