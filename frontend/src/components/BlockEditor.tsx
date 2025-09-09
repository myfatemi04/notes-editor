import {
  ChangeEventHandler,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { createFile, createProcessor, post } from "./rmd-modified";

const processor = createProcessor({
  remarkPlugins: [remarkMath, remarkGfm],
  rehypePlugins: [rehypeKatex],
});

function Block({
  editing,
  setEditingOffset,
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
  let preview: ReactElement | null = null;
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
      if (e.key === "ArrowUp" && textarea.selectionStart === 0) {
        e.preventDefault();
        setEditingOffset(start - 1);
      } else if (
        e.key === "ArrowDown" &&
        textarea.selectionStart === textarea.value.length
      ) {
        e.preventDefault();
        setEditingOffset(end);
      } else {
        setEditingOffset(start + textarea.selectionStart);

        console.log("setting editing offset to", {
          start,
          selectionStart: textarea.selectionStart,
          offset: start + textarea.selectionStart,
          end,
        });
      }

      if (e.key === "z" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        undo();
      }
    };

    textarea.addEventListener("keydown", keyListener);
    return () => {
      textarea.removeEventListener("keydown", keyListener);
    };
  }, [editing, start, end, undo]);

  if (!editing) {
    const transformed = processor.runSync(tree, file);
    preview = post(transformed, {
      allowedElements,
      allowElement,
      components,
      disallowedElements,
      skipHtml,
      unwrapDisallowed,
      urlTransform,
    });
  }

  const content = file.value.slice(
    tree.children[0].position.start.offset,
    tree.children[0].position.end.offset
  );
  const lines = content.split("\n").length;

  if (textareaRef.current) {
    const textarea = textareaRef.current;
    if (textarea.scrollHeight < 14) {
      textarea.style.height = "18px";
    }
    setTimeout(() => {
      textarea.style.height = textarea.scrollHeight + "px";
    }, 0);
  }

  return (
    <div
      style={{ borderTop: "1px solid red", padding: "12px" }}
      onClick={() => setEditingOffset(start)}
    >
      {preview}
      <textarea
        className="textarea-for-block"
        rows={lines + 1}
        style={{ display: editing ? "block" : "none" }}
        onChange={onChange}
        value={content}
        ref={textareaRef}
      ></textarea>
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
  const file = createFile({ children: value });
  const tree = processor.parse(file);
  let [editingOffset, setEditingOffset] = useState(0);

  // Determine which block is being edited.
  const children = tree.children.filter((child) => !!child.position);

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

        const onBlockChange: ChangeEventHandler<HTMLTextAreaElement> = (e) => {
          const before = value.slice(0, start);
          const after = value.slice(end);
          console.log("setting value to", JSON.stringify(e.target.value));
          onChange(before + e.target.value + after);
        };

        // console.log({ editingOffset, start, end, editing });

        return (
          <Block
            key={i}
            undo={undo}
            editing={editing}
            setEditingOffset={setEditingOffset}
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
