import {
  ChangeEventHandler,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { createFile, createProcessor, post } from "./rmd-modified";
import { getEventListener } from "./pasteAsHTML";

const processor = createProcessor({
  remarkPlugins: [remarkMath, remarkGfm],
  rehypePlugins: [rehypeKatex],
});

function Block({
  editing,
  defaultEditingOffset,
  setEditingOffset,
  onBeginningBackspace,
  onEndEnter,
  start,
  end,
  tree,
  file,
  allowedElements,
  allowElement,
  components,
  disallowedElements,
  skipHtml,
  unwrapDisallowed,
  urlTransform,
  onChange,
  undo,
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    if (editing) {
      textarea.focus();
    }

    const keyListener = (e: KeyboardEvent) => {
      const isBackspaceAtBeginning =
        e.key === "Backspace" &&
        textarea.selectionStart === 0 &&
        textarea.selectionEnd === 0;

      if (isBackspaceAtBeginning) {
        e.preventDefault();
        onBeginningBackspace();
      }

      if (
        e.key === "Enter" &&
        textarea.selectionStart === textarea.value.length
      ) {
        e.preventDefault();
        onEndEnter();
      }

      if (
        (["ArrowUp", "ArrowLeft"].includes(e.key) &&
          textarea.selectionStart === 0) ||
        isBackspaceAtBeginning
      ) {
        e.preventDefault();
        setEditingOffset(start - 2);
      } else if (
        ["ArrowRight", "ArrowDown"].includes(e.key) &&
        textarea.selectionStart === textarea.value.length
      ) {
        e.preventDefault();
        setEditingOffset(end + 1);
      }

      if (e.key === "z" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        undo();
      }
    };

    const pasteListener = getEventListener();
    textarea.addEventListener("paste", pasteListener);
    textarea.addEventListener("keydown", keyListener);
    return () => {
      textarea.removeEventListener("keydown", keyListener);
      textarea.removeEventListener("paste", pasteListener);
    };
  }, [editing, start, end, undo, onBeginningBackspace]);

  const preview = useMemo(
    () =>
      post(tree, {
        allowedElements,
        allowElement,
        components,
        disallowedElements,
        skipHtml,
        unwrapDisallowed,
        urlTransform,
      }),
    [
      tree,
      file,
      allowedElements,
      allowElement,
      components,
      disallowedElements,
      skipHtml,
      unwrapDisallowed,
      urlTransform,
    ]
  );

  if (textareaRef.current) {
    const textarea = textareaRef.current;
    textarea.style.height = "auto";
  }

  useEffect(() => {
    // This should only apply in the beginning.
    if (editing && textareaRef.current) {
      const defaultCursorPosition = defaultEditingOffset - start;
      textareaRef.current.selectionStart = defaultCursorPosition + 1;
      textareaRef.current.selectionEnd = defaultCursorPosition + 1;
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
      onClick={() => setEditingOffset(start)}
    >
      <div style={{ flex: 1, display: editing ? "block" : "none" }}>
        <textarea
          className="textarea-for-block"
          onChange={onChange}
          // All blocks are normalized to have two newlines at the end.
          value={file.value.slice(start, end - 2)}
          ref={textareaRef}
        ></textarea>
      </div>
      <div style={{ flex: 1, marginLeft: "12px" }}>{preview}</div>
    </div>
  );
}

/*
Editor that creates blocks.
*/
export default function BlockEditor({
  value,
  onChange,
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
  const file = useMemo(() => createFile({ children: value }), [value]);
  // const tree = useMemo(() => processor.parse(file), [file]);
  const tree = useMemo(
    () => processor.runSync(processor.parse(file), file),
    [file]
  );
  let [editingOffset, setEditingOffset] = useState(0);

  const children = tree.children.filter((child) => !!child.position);

  // || [
  //   {
  //     type: "paragraph",
  //     children: [],
  //     position: {
  //       start: { column: 0, line: 0, offset: 0 },
  //       end: { column: 0, line: 0, offset: 1 },
  //     },
  //   },
  // ];

  const previousValuesRef = useRef<string[]>([]);

  useEffect(() => {
    if (value == previousValuesRef.current.at(-1)) {
      return;
    }

    if (previousValuesRef.current.length > 5) {
      previousValuesRef.current.shift();
    }
    previousValuesRef.current.push(value);
  }, [value]);

  const undo = () => {
    if (previousValuesRef.current.length < 2) {
      return;
    }
    previousValuesRef.current.pop();
    const previous = previousValuesRef.current.at(-1);
    if (previous !== undefined) {
      onChange(previous);
    }
  };

  if (editingOffset > value.length) {
    editingOffset = value.length;
    setEditingOffset(value.length);
  } else if (editingOffset < 0) {
    editingOffset = 0;
    setEditingOffset(0);
  }

  // console.log({
  //   spans: children.map((c) => ({
  //     start: c.position?.start.offset,
  //     end: c.position?.end.offset,
  //   })),
  //   editingOffset,
  //   valueLength: value.length,
  // });

  // Normalize so each block ends with a newline (a pad character).
  useEffect(() => {
    let blockTexts: string[] = [];
    let textLength = 0;
    let newCursorPosition = editingOffset;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const start = child.position!.start.offset!;
      const end =
        i < children.length - 1
          ? children[i + 1].position!.start.offset!
          : value.length + 1;
      let blockValue = value.slice(start, end);

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
      textLength += blockValue.length;

      while (newlineCount < 2) {
        if (newCursorPosition > textLength + 1) {
          console.log("adjusting cursor position up");
          newCursorPosition += 1;
        }
        console.log("adding newline to block");
        blockTexts[i] += "\n";
        textLength += 1;
        newlineCount += 1;
      }
      while (newlineCount > 2) {
        if (newCursorPosition >= textLength - 1) {
          console.log("adjusting cursor position down");
          newCursorPosition -= 1;
        }
        console.log("removing newline from block");
        blockTexts[i] = blockTexts[i].slice(0, -1);
        textLength -= 1;
        newlineCount -= 1;
      }
    }
    const newValue = blockTexts.join("") || ".";
    if (newValue !== value) {
      // console.log(
      //   "normalizing value",
      //   JSON.stringify(value),
      //   "to",
      //   JSON.stringify(newValue)
      // );
      onChange(newValue);
      setTimeout(() => {
        setEditingOffset(newCursorPosition);
      }, 0);
    }
  }, [value, editingOffset]);

  return (
    <div style={{ overflowY: "auto" }}>
      {children.map((child, i) => {
        // Edit spans so child ends at next child's start.
        const start = child.position!.start.offset!;
        const end =
          i < children.length - 1
            ? children[i + 1].position!.start.offset!
            : value.length + 1;

        let editing = start <= editingOffset && editingOffset < end;

        if (editing) {
          console.log("editing block", i, "at offset", editingOffset, {
            start,
            end,
          });
        }

        const onBlockChange: ChangeEventHandler<HTMLTextAreaElement> = (e) => {
          const before = value.slice(0, start);
          const after = value.slice(end);
          let textareaValue = e.target.value;
          if (e.target.value.startsWith(".") && e.target.value.length > 1) {
            textareaValue = e.target.value.slice(1);
          } else if (
            // These are for equations, and if partially complete then they mess up the editor.
            e.target.value.trim() === "$$" ||
            e.target.value.trim() === "$$$$"
          ) {
            textareaValue = "$$ $$";
            setEditingOffset(start + 1);
          }
          // The two newlines were truncated from the textarea.
          const newBlockValue = textareaValue + "\n\n";
          const newValue = before + newBlockValue + after;
          // console.log(
          //   "setting value to",
          //   JSON.stringify(newBlockValue),
          //   "from",
          //   JSON.stringify(blockValue),
          //   "whole value",
          //   JSON.stringify(newValue)
          // );
          onChange(newValue);
        };

        const onBeginningBackspace = () => {
          if (i === 0) {
            return;
          }
          const newValue = value.slice(0, start - 1) + value.slice(start);
          onChange(newValue);
          setEditingOffset(start - 1);
          console.log(
            "setting editing offset to",
            start - 1,
            "value before is",
            JSON.stringify(newValue.slice(0, start - 1)),
            "value after is",
            JSON.stringify(newValue.slice(start - 1))
          );
        };

        const onEndEnter = () => {
          const newValue =
            value.slice(0, end) + "\n\n.\n\n" + value.slice(end, value.length);
          onChange(newValue);
          setEditingOffset(end + 2);
          console.log(
            "adding new block after",
            i,
            "setting editing offset to",
            end + 2,
            "value before is",
            JSON.stringify(newValue.slice(0, end + 2)),
            "value after is",
            JSON.stringify(newValue.slice(end + 2))
          );
        };

        return (
          <Block
            key={i}
            undo={undo}
            editing={editing}
            defaultEditingOffset={editingOffset}
            setEditingOffset={setEditingOffset}
            onBeginningBackspace={onBeginningBackspace}
            onEndEnter={onEndEnter}
            start={start}
            end={end}
            tree={{ children: [child], type: "root" }}
            file={file}
            allowedElements={allowedElements}
            allowElement={allowElement}
            components={components}
            disallowedElements={disallowedElements}
            skipHtml={skipHtml}
            unwrapDisallowed={unwrapDisallowed}
            urlTransform={urlTransform}
            onChange={onBlockChange}
          />
        );
      })}
    </div>
  );
}
