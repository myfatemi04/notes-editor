import { ChangeEvent, useCallback, useEffect, useRef } from "react";
import { BlockProps, Update } from "./Block";
import { processor } from "./BlockEditor";
import getPasteListener from "./pasteAsHTML";
import { createFile, post } from "./rmd-modified";
import e from "express";

const EMPTY_SPECIAL_STRING = "(empty)";

function makeNavigationHook(
  editPrevious: () => void,
  editNext: () => void,
  editNone: () => void
) {
  return (e: KeyboardEvent) => {
    const target = e.target as HTMLTextAreaElement;
    if (target.selectionStart !== target.selectionEnd) {
      return;
    }

    const cursor = target.selectionStart;

    // Pressing arrow keys on first or last lines should move to previous/next block
    // Pressing left/right at beginning/end of text should move to previous/next block
    if (e.key === "ArrowUp" && cursor === 0) {
      editPrevious();
    } else if (e.key === "ArrowDown" && cursor === target.value.length) {
      editNext();
    } else if (e.key === "ArrowLeft" && cursor === 0) {
      editPrevious();
    } else if (e.key === "ArrowRight" && cursor === target.value.length) {
      editNext();
    } else if (e.key === "Escape") {
      editNone();
    } else {
      // Nothing special, so return. Otherwise, preventDefault.
      return;
    }

    e.preventDefault();
  };
}

function checkBackspaceEditHook(
  event: KeyboardEvent,
  update: (update: Update) => void
) {
  if (event.key !== "Backspace") return;

  const textarea = event.target as HTMLTextAreaElement;
  if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
    update({ type: "merge_previous" });
    return true;
  }
}

function checkBackspaceMathCodeEditHook(
  event: KeyboardEvent,
  update: (update: Update) => void
) {
  if (event.key !== "Backspace") return;

  const textarea = event.target as HTMLTextAreaElement;
  if (textarea.selectionStart !== textarea.selectionEnd) {
    return;
  }

  if (textarea.value.length === 0) {
    update({ type: "set_content", content: "(empty)" });
    return true;
  }
}

function checkUndoEditHook(
  event: KeyboardEvent,
  update: (update: Update) => void
) {
  if (event.key !== "z" || !(event.metaKey || event.ctrlKey)) {
    return;
  }

  update({ type: "undo" });

  return true;
}

function checkEnterEditHook(
  event: KeyboardEvent,
  update: (update: Update) => void
) {
  if (event.key !== "Enter") return;

  const textarea = event.target as HTMLTextAreaElement;

  // Handle special commands
  if (textarea.value === "/math") {
    update({
      type: "set_content",
      content: "$$\n\n$$",
    });

    return true;
  } else if (textarea.value === "/code") {
    update({
      type: "set_content",
      content: "```\n\n```",
    });

    return true;
  } else if (textarea.value === "/canvas") {
    update({
      type: "set_content",
      content: "![@canvas]()",
    });

    return true;
  }

  const before = textarea.value.slice(0, textarea.selectionStart);
  const after = textarea.value.slice(textarea.selectionStart);

  update({
    type: "replace",
    replacements: [
      before.trim() || EMPTY_SPECIAL_STRING,
      after.trim() || EMPTY_SPECIAL_STRING,
    ],
  });

  return true;
}

function checkListEditHook(
  event: KeyboardEvent,
  update: (update: Update) => void
) {
  const textarea = event.target as HTMLTextAreaElement;

  // Lists are a bunch of lines. The cursor will lie on one of the lines. A block is a list block if it starts with '- ', '* ', or '1. '.
  if (
    !(
      textarea.value.startsWith("- ") ||
      textarea.value.startsWith("* ") ||
      textarea.value.startsWith("1. ")
    )
  ) {
    return;
  }

  type ListItem = {
    indent: number;
    marker: string;
    start: number;
    end: number;
    body: string;
  };

  const list: ListItem[] = [];
  let start = 0;
  let end = 0;
  for (const line of textarea.value.split("\n")) {
    end += line.length + 1;
    if (line.trim()) {
      const body = line.trimStart();
      let marker: string;
      if (body.startsWith("-")) {
        marker = "-";
      } else if (body.startsWith("*")) {
        marker = "*";
      } else {
        marker = "1.";
      }
      const space = line.slice(0, line.length - body.length);
      const indent = space.replace(/\t/g, "  ").length;
      list.push({ indent, marker, start, end, body });
    }
    start = end;
  }

  if (event.key === "Tab") {
    // Indent/deindent.
    for (const item of list) {
      const selected =
        item.start <= textarea.selectionStart ||
        item.end >= textarea.selectionEnd;
      if (selected) {
        item.indent = Math.max(0, item.indent + (event.shiftKey ? -2 : 2));
      }
    }

    const content = list
      .map((item) => " ".repeat(item.indent) + item.marker + " " + item.body)
      .join("\n");

    update({ type: "set_content", content });

    return true;
  } else if (event.key === "Enter") {
    // Add new list item or remove if empty and final list item.
    if (textarea.selectionStart !== textarea.selectionEnd) {
      return true;
    }

    // Find indentation and marker of current line.
    const cursor = textarea.selectionStart;
    let currentItem: ListItem | null = null;
    for (const item of list) {
      if (item.start <= cursor && item.end >= cursor) {
        currentItem = item;
        break;
      }
    }
    if (!currentItem) {
      return true;
    }

    // Check if the current item's content is empty (after the marker) and
    // this list item is the last one (the `end` property is the last of its kind)
    if (
      currentItem.body.trim() === currentItem.marker &&
      currentItem.end === end
    ) {
      // Remove this list item.
      const before = textarea.value.slice(0, currentItem.start).trimEnd();
      update({
        type: "set_content",
        content: before === "" ? EMPTY_SPECIAL_STRING : before,
      });
      update({ type: "insert_after" });
      return true;
    }

    // Add a new list item with the same indentation and marker.
    const newListItemPrefix =
      "\n" + " ".repeat(currentItem.indent) + currentItem.marker + " ";
    const before = textarea.value.slice(0, cursor);
    const after = textarea.value.slice(cursor);
    const emptyItem =
      currentItem.body.slice(currentItem.body.indexOf(" ") + 1).trim() === "";
    const finalItem = currentItem.end === textarea.value.length;

    if (emptyItem && finalItem) {
      // Slice to right before this list item.
      update({
        type: "replace",
        replacements: [
          before.slice(0, before.lastIndexOf("\n")),
          EMPTY_SPECIAL_STRING,
        ],
      });
    } else {
      update({
        type: "set_content",
        content: before + newListItemPrefix + after,
      });
    }

    return true;
  }
}

function checkForceInsertMathCodeEditHook(
  e: KeyboardEvent,
  update: (update: Update) => void
) {
  if (e.key === "Enter" && e.shiftKey) {
    update({ type: "insert_after" });
    e.preventDefault();
  }
}

function makeEditHook(update: (update: Update) => void, isRichText: boolean) {
  return (e: KeyboardEvent) => {
    if (
      // Order matters. Pressing enter in a list should add a new list item, while pressing enter outside should split the block.
      checkUndoEditHook(e, update) ||
      (isRichText
        ? checkBackspaceEditHook(e, update) ||
          checkListEditHook(e, update) ||
          checkEnterEditHook(e, update)
        : checkBackspaceMathCodeEditHook(e, update)) ||
      checkForceInsertMathCodeEditHook(e, update)
    ) {
      e.preventDefault();
    }
  };
}

export default function TextBlock(
  props: BlockProps & { blockType: "code" | "text" | "math" }
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const editHook = makeEditHook(props.update, props.blockType === "text");
    const navigationHook = makeNavigationHook(
      props.editPrevious,
      props.editNext,
      () => props.setEditing(false)
    );
    const pasteListener = getPasteListener();
    textarea.addEventListener("paste", pasteListener);
    textarea.addEventListener("keydown", editHook);
    textarea.addEventListener("keydown", navigationHook);

    return () => {
      textarea.removeEventListener("paste", pasteListener);
      textarea.removeEventListener("keydown", editHook);
      textarea.removeEventListener("keydown", navigationHook);
    };
  }, [props.update, props.editPrevious, props.editNext, props.blockType]);

  const onChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      let content = e.target.value;
      if (props.blockType === "code") {
        content =
          props.content.slice(0, props.content.indexOf("\n")) +
          "\n" +
          content +
          "\n```";
      } else if (props.blockType === "math") {
        content = "$$" + "\n" + content + "\n$$";
      } else if (content.trim() === "") {
        content = EMPTY_SPECIAL_STRING;
      } else {
        content = content.replace(/\`\`\`/g, "\\`\\`\\`");
        content = content.replace(/\$\$/g, "$ $");
      }
      props.update({ type: "set_content", content });
    },
    [props.update]
  );

  if (textareaRef.current) {
    const textarea = textareaRef.current;
    textarea.style.height = "";
  }

  useEffect(() => {
    // This should only apply in the beginning.
    if (props.editing && textareaRef.current) {
      const cursor =
        props.cursor < 0
          ? textareaRef.current.value.length - props.cursor + 1
          : props.cursor;

      textareaRef.current.selectionStart = cursor;
      textareaRef.current.selectionEnd = cursor;
      textareaRef.current.focus();
    }
  }, [props.editing]);

  const setCodeLang = useCallback(
    (lang: string) => {
      props.update({
        type: "set_content",
        content: `\`\`\`${lang}\n${textareaRef.current!.value}\`\`\``,
      });
    },
    [props.update]
  );

  let textareaContent: string;
  if (props.blockType === "code") {
    const code = props.content.slice(
      props.content.indexOf("\n") + 1,
      props.content.lastIndexOf("\n```")
    );
    textareaContent = code.replace(/\\`$/, "`");
  } else if (props.blockType === "math") {
    textareaContent = props.content.slice(3, props.content.length - 3);
  } else if (props.content === EMPTY_SPECIAL_STRING) {
    textareaContent = "";
  } else {
    textareaContent = props.content;
  }

  // Not the culprit.
  const file = createFile({ children: props.content });
  const tree = processor.parse(file);

  return (
    <>
      <div
        style={{
          flex: 1,
          display: props.editing ? "block" : "none",
          paddingTop: "6px",
        }}
      >
        {/* Mutually exclusive. */}
        {props.blockType !== "text" && `(${props.blockType})`}
        {props.blockType === "code" &&
          (() => {
            // Try to extract language from first line.
            const firstLine = props.content.slice(
              0,
              props.content.indexOf("\n")
            );
            const lang = firstLine.slice("```".length).trim();
            return (
              <select
                className="language-select-for-block"
                value={lang}
                onChange={(e) => setCodeLang(e.target.value)}
              >
                <option value="">Select language...</option>
                <option value="text">Text</option>
              </select>
            );
          })()}
        <textarea
          className="textarea-for-block"
          value={textareaContent}
          ref={textareaRef}
          onChange={onChange}
        />
      </div>
      <div
        style={{
          flex: 1,
          marginLeft: "12px",
          fontFamily: "sans-serif",
          borderLeft: "1px solid black",
          borderRight: "1px solid black",
          paddingLeft: "12px",
          paddingRight: "12px",
        }}
      >
        {post(processor.runSync(tree, file), props.mdopts)}
      </div>
    </>
  );
}
