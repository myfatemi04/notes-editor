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
  previousBlockOffset,
  nextBlockOffset,
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
}) {
  let preview: ReactElement | null = null;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  console.log(
    "my selectionStart:",
    textareaRef.current?.selectionStart,
    "my length:",
    textareaRef.current?.value.length
  );

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
        console.log("Going to previous block at", previousBlockOffset);
        setEditingOffset(previousBlockOffset);
      } else if (
        e.key === "ArrowDown" &&
        textarea.selectionStart === textarea.value.length
      ) {
        e.preventDefault();
        console.log("Going to next block at", nextBlockOffset);
        setEditingOffset(nextBlockOffset);
      } else {
        console.log("Setting offset to", {
          offset:
            tree.children[0].position.start.offset + textarea.selectionStart,
          startOffset: tree.children[0].position.start.offset,
          selectionStart: textarea.selectionStart,
        });
        setEditingOffset(
          tree.children[0].position.start.offset + textarea.selectionStart
        );
      }
    };

    textarea.addEventListener("keydown", keyListener);
    return () => {
      textarea.removeEventListener("keydown", keyListener);
    };
  }, [editing]);

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

  return (
    <div style={{ borderTop: "1px solid red" }}>
      {preview}
      <textarea
        style={{ display: editing ? "block" : "none" }}
        onChange={onChange}
        value={file.value.slice(
          tree.children[0].position.start.offset,
          tree.children[0].position.end.offset
        )}
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
  const [editingOffset, setEditingOffset] = useState(0);

  // Determine which block is being edited.
  const children = tree.children.filter((child) => !!child.position);

  return (
    <>
      {children.map((child, i) => {
        const start = child.position!.start.offset!;
        const end = child.position!.end.offset!;
        const editing = start <= editingOffset && editingOffset <= end;

        const onBlockChange: ChangeEventHandler<HTMLTextAreaElement> = (e) => {
          const before = value.slice(0, start);
          const after = value.slice(end);
          onChange(before + e.target.value + after);
        };

        console.log({ editingOffset, start, end, editing });

        return (
          <Block
            key={i}
            editing={editing}
            setEditingOffset={setEditingOffset}
            // There may be whitespace filtered out between blocks.
            previousBlockOffset={
              i > 0 ? children[i - 1].position!.end.offset! - 1 : 0
            }
            nextBlockOffset={
              i < children.length - 1
                ? children[i + 1].position!.start.offset
                : value.length - 1
            }
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
    </>
  );
}
