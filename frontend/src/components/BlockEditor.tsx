import { useEffect, useMemo, useRef, useState } from "react";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { getEventListener } from "./pasteAsHTML";
import { createFile, createProcessor, post } from "./rmd-modified";

const processor = createProcessor({
  remarkPlugins: [remarkMath, remarkGfm],
  rehypePlugins: [rehypeKatex],
});

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
      } else if (
        e.key === "ArrowDown" &&
        (lastLineStart === 0 || cursor > lastLineStart)
      ) {
        e.preventDefault();
        editNext();
        logEvent("edit-next-arrowdown", { cursor, lastLineStart });
      }

      // Pressing left/right at beginning/end of text should move to previous/next block
      if (e.key === "ArrowLeft" && cursor === 0) {
        e.preventDefault();
        editPrevious();
        logEvent("edit-previous-arrowleft", { cursor });
      }

      if (e.key === "ArrowRight" && cursor === textarea.value.length) {
        e.preventDefault();
        editNext();
        logEvent("edit-next-arrowright", { cursor });
      }

      // Pressing Enter in a block should create a new block below, with the content of the current block split at the cursor.
      if (e.key === "Enter") {
        e.preventDefault();
        split(cursor);
        logEvent("split", { cursor });
      }

      // Pressing Backspace at the beginning of a block should merge with the previous block.
      if (e.key === "Backspace" && cursor === 0) {
        e.preventDefault();
        mergePrevious();
        logEvent("merge-previous");
      }
    };

    const changeListener = () => {
      setContent(textarea.value);
    };

    const pasteListener = getEventListener();
    textarea.addEventListener("paste", pasteListener);
    textarea.addEventListener("keydown", keyListener);
    textarea.addEventListener("change", changeListener);

    return () => {
      textarea.removeEventListener("keydown", keyListener);
      textarea.removeEventListener("paste", pasteListener);
      textarea.removeEventListener("change", changeListener);
    };
  }, [editing, undo]);

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
        borderTop: "1px solid red",
        padding: "12px",
        display: "flex",
        alignItems: "center",
      }}
      onClick={() => !editing && editMe()}
    >
      <div style={{ flex: 1, display: editing ? "block" : "none" }}>
        <textarea
          className="textarea-for-block"
          onChange={() => {
            if (!textareaRef.current) return;
            return setContent(textareaRef.current?.value);
          }}
          value={content}
          ref={textareaRef}
        />
      </div>
      <div style={{ flex: 1, marginLeft: "12px" }}>
        {post({ type: "root", children: [ast] }, mdopts)}
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
  return blockTexts.join("") || "(empty)\n\n";
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
  const tree = useMemo(
    () => processor.runSync(processor.parse(file), file),
    [file]
  );
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const children = tree.children.filter((child) => !!child.position);
  const previousValuesRef = useRef<string[]>([]);

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
            previousChildContent + blockContent;

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
          const afterWithDelimiter = `${after.trim() ? after : "(empty)"}\n\n`;

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
