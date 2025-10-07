import { useCallback, useEffect, useRef, useState } from "react";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import Block, { Update } from "./Block";
import { createFile, createProcessor } from "./rmd-modified";

export const processor = createProcessor({
  remarkPlugins: [remarkMath, remarkGfm],
  rehypePlugins: [rehypeKatex],
});

interface Block {
  content: string;
  key: string;
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
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const previousValuesRef = useRef<Block[][]>([]);
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
      .filter((x) => x !== null)
      .map((content) => ({
        content,
        key: Math.random().toString(36).substring(2, 15),
      }));
  }, []);

  // Parse during first render.
  useEffect(() => {
    setBlocks(parse(content));
  }, []);

  useEffect(() => {
    previousValuesRef.current.push(blocks);
    if (previousValuesRef.current.length > 100) {
      previousValuesRef.current.shift();
    }
    setContent(blocks.map((b) => b.content.trim()).join("\n\n") + "\n\n");
  }, [blocks]);

  const undo = useCallback(() => {
    if (previousValuesRef.current.length < 2) {
      return;
    }
    previousValuesRef.current.pop();
    const previous = previousValuesRef.current.at(-1);
    if (previous !== undefined) {
      setBlocks(previous);
    }
  }, []);

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
    cursorRef.current = -1;
    setEditingIndex((i) => (i! > 0 ? i! - 1 : i));
  }, []);
  const editNext = useCallback(() => {
    cursorRef.current = 0;
    setEditingIndex((i) => (i! < blocks.length - 1 ? i! + 1 : i));
  }, [blocks.length]);
  const setEditingKey = useCallback(
    (key: string) => {
      const index = blocks.findIndex((b) => b.key === key);
      if (index !== -1) {
        setEditingIndex(index);
      }
    },
    [blocks]
  );

  return (
    <div style={{ overflowY: "auto" }}>
      {blocks.map((block, i) => {
        const update = (update: Update) => {
          switch (update.type) {
            case "replace":
              setBlocks((blocks) =>
                blocks
                  .slice(0, i)
                  .concat(
                    update.replacements.map((content) => ({
                      content,
                      key: Math.random().toString(36).substring(2, 15),
                    }))
                  )
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
              if (
                blocks[i - 1].content.startsWith("$$") ||
                blocks[i - 1].content.startsWith("```")
              ) {
                return;
              }
              setBlocks((blocks) => {
                const effectivePrev =
                  blocks[i - 1].content === "(empty)"
                    ? ""
                    : blocks[i - 1].content;
                const effectiveCurr =
                  blocks[i].content === "(empty)" ? "" : blocks[i].content;
                cursorRef.current = effectivePrev.length;
                const replacement =
                  (effectivePrev + effectiveCurr).trim() || "(empty)";
                return blocks
                  .slice(0, i - 1)
                  .concat([{ content: replacement, key: blocks[i - 1].key }])
                  .concat(blocks.slice(i + 1));
              });
              setEditingIndex((index) => index! - 1);
              break;

            case "set_content":
              setBlocks((blocks) =>
                blocks
                  .slice(0, i)
                  .concat([{ content: update.content, key: blocks[i].key }])
                  .concat(blocks.slice(i + 1))
              );
              break;

            case "undo":
              undo();
              break;
          }
        };
        const editing = editingIndex === i;
        const maxWidth = !editing ? "600px" : "1200px";

        return (
          // Moving this outward allows the setEditingIndex callback to be fresh, while having the content of the block memoized.
          <div
            style={{
              borderBottom: "1px solid red",
              paddingLeft: `calc(max((100% - ${maxWidth}) / 2, 12px))`,
              paddingRight: `calc(max((100% - ${maxWidth}) / 2, 12px))`,
              display: "flex",
              alignItems: "center",
            }}
            onClick={() => {
              if (!editing) {
                cursorRef.current = 0;
                setEditingIndex(i);
              }
            }}
            key={block.key}
          >
            <Block
              update={update}
              editing={editing}
              editPrevious={editPrevious}
              editNext={editNext}
              setEditing={() => setEditingIndex(i)}
              content={block.content}
              cursor={cursorRef.current}
              mdopts={mdopts}
            />
          </div>
        );
      })}
      <button
        onClick={() => {
          setBlocks((blocks) =>
            blocks.concat([
              {
                content: "(empty)",
                key: Math.random().toString(36).substring(2, 15),
              },
            ])
          );
          setEditingIndex(blocks.length);
        }}
        className="button"
        style={{ marginLeft: "12px", marginTop: "12px", border: 0 }}
      >
        Add block
      </button>
      <div style={{ height: "100vh" }} onClick={() => setEditingIndex(null)} />
    </div>
  );
}
