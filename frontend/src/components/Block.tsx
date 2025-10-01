import { memo } from "react";
import Canvas, { CanvasHostContext } from "./Canvas";
import { post } from "./rmd-modified";
import TextBlock from "./TextBlock";

export interface MergePreviousUpdate {
  type: "merge_previous";
}
export interface SetContentUpdate {
  type: "set_content";
  content: string;
}
export interface ReplaceUpdate {
  type: "replace";
  replacements: string[];
}
export interface UndoUpdate {
  type: "undo";
}
export type Update =
  | MergePreviousUpdate
  | SetContentUpdate
  | ReplaceUpdate
  | UndoUpdate;

export interface MarkdownOptions {
  allowedElements?: string[] | undefined;
  allowElement?: ((element: any) => boolean) | undefined;
  components?: Record<string, unknown> | undefined;
  disallowedElements?: string[] | undefined;
  skipHtml?: boolean | undefined;
  unwrapDisallowed?: boolean | undefined;
  urlTransform?: ((url: string) => string) | undefined;
}

export interface BlockProps {
  editing: boolean;
  editPrevious: () => void;
  editNext: () => void;
  setEditing: (e: boolean) => void;
  content: string;
  update: (update: Update) => void;
  cursor: number;
  index: number;
  mdopts: MarkdownOptions;
}
const CANVAS_URL_BASE = "data:image/minicanvas;base64,";

function getBlockType(content: string): "text" | "code" | "math" | "canvas" {
  if (content.startsWith("```")) {
    return "code";
  }
  if (content.startsWith("$$")) {
    return "math";
  }
  if (content.startsWith("![")) {
    if (content.indexOf("](") !== -1) {
      const url = content.substring(
        content.indexOf("](") + 2,
        content.length - 1
      );
      if (url.startsWith(CANVAS_URL_BASE)) {
        return "canvas";
      }
    }
  }
  return "text";
}

function codeTextareaContentToContent(
  content: string,
  language: string
): string {
  return "```" + language + "\n" + content.replace(/`/g, "\\`") + "```";
}
function contentToCodeTextareaContent(content: string): string {
  const code = content.slice(
    content.indexOf("\n") + 1,
    content.lastIndexOf("\n```")
  );
  return code.replace(/\\`$/, "`");
}

export default memo(
  function Block(props: BlockProps) {
    let inner: JSX.Element;

    switch (getBlockType(props.content)) {
      case "code":
        inner = <TextBlock {...props} blockType="code" />;
      case "math":
        inner = <TextBlock {...props} blockType="math" />;
      case "text":
        inner = <TextBlock {...props} blockType="text" />;
      case "canvas":
        inner = (
          <CanvasHostContext.Provider
            value={{
              setB64: setFromTextareaContent,
              b64: textareaContent,
              editing: props.editing,
            }}
          >
            <Canvas />
          </CanvasHostContext.Provider>
        );
    }

    const maxWidth = !props.editing ? "600px" : "1200px";

    return (
      <div
        style={{
          borderBottom: "1px solid red",
          paddingLeft: `calc(max((100% - ${maxWidth}) / 2, 12px))`,
          paddingRight: `calc(max((100% - ${maxWidth}) / 2, 12px))`,
          display: "flex",
          alignItems: "center",
          minHeight: "10px",
        }}
        onClick={() => !props.editing && props.setEditing(true)}
      >
        {inner}
      </div>
    );
  },
  // Always change if editing.
  // Otherwise, only change if content changed.
  (prev, next) => {
    return (
      prev.editing === next.editing &&
      prev.content === next.content &&
      // Shift effects
      prev.index === next.index
    );
  }
);
