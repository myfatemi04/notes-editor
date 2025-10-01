import { useCallback, useEffect, useRef, useState } from "react";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import Block, { Update } from "./Block";
import { createFile, createProcessor } from "./rmd-modified";

const processor = createProcessor({
  remarkPlugins: [remarkMath, remarkGfm],
  rehypePlugins: [rehypeKatex],
});

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
}) {
  const [blocks, setBlocks] = useState<string[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const previousValuesRef = useRef<string[]>([content]);
  const cursorRef = useRef<number>(0);

  const parse = useCallback((content: string) => {
    const file = createFile({ children: content });
    const tree = processor.parse(file);
    return tree.children
      .map((child) =>
        child.position != null
          ? content.slice(
              child.position.start.offset,
              child.position.end.offset
            )
          : null
      )
      .filter((x) => x !== null);
  }, []);

  // Parse during first render.
  useEffect(() => {
    setBlocks(parse(content));
  }, []);

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

  const editPrevious = useCallback(() => {
    setEditingIndex((i) => (i! > 0 ? i! - 1 : i));
  }, []);
  const editNext = useCallback(() => {
    setEditingIndex((i) => (i! < blocks.length - 1 ? i! + 1 : i));
  }, [blocks.length]);

  return (
    <div style={{ overflowY: "auto" }}>
      {blocks.map((content, i) => {
        const update = (update: Update) => {
          switch (update.type) {
            case "replace":
              setBlocks((blocks) =>
                blocks
                  .slice(0, i)
                  .concat(update.replacements)
                  .concat(blocks.slice(i + 1))
              );

              setEditingIndex(
                (index) => index! + update.replacements.length - 1
              );
              break;

            case "merge_previous":
              if (i === 0) {
                return;
              }
              setBlocks((blocks) =>
                blocks
                  .slice(0, i - 1)
                  .concat([blocks[i - 1] + blocks[i]])
                  .concat(blocks.slice(i + 1))
              );
              setEditingIndex((index) => index! - 1);
              break;

            case "set_content":
              setBlocks((blocks) =>
                blocks
                  .slice(0, i)
                  .concat([update.content])
                  .concat(blocks.slice(i + 1))
              );

            case "undo":
              undo();
              break;
          }
        };

        return (
          <Block
            index={i}
            update={update}
            editing={editingIndex === i}
            editPrevious={editPrevious}
            editNext={editNext}
            setEditing={() => setEditingIndex(i)}
            content={content}
            cursor={cursorRef.current}
            mdopts={mdopts}
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
