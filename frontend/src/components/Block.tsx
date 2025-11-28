import { memo } from "react";
import Canvas, { CanvasHostContext } from "./Canvas";
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
export interface InsertAfterUpdate {
  type: "insert_after";
}
export type Update =
  | MergePreviousUpdate
  | SetContentUpdate
  | ReplaceUpdate
  | UndoUpdate
  | InsertAfterUpdate;

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

export default memo(
  function Block(props: BlockProps) {
    let inner: JSX.Element;

    switch (getBlockType(props.content)) {
      case "code":
        inner = <TextBlock {...props} blockType="code" />;
        break;
      case "math":
        inner = <TextBlock {...props} blockType="math" />;
        break;
      case "text":
        inner = <TextBlock {...props} blockType="text" />;
        break;
      case "canvas":
        inner = (
          <CanvasHostContext.Provider
            value={{
              setB64: (b64: string) => {
                if (b64.length === 0) {
                  props.update({ type: "replace", replacements: [] });
                } else {
                  props.update({
                    type: "set_content",
                    content: `![@canvas](${CANVAS_URL_BASE}${b64})`,
                  });
                }
              },
              b64: props.content.slice(
                props.content.indexOf("(") + 1 + CANVAS_URL_BASE.length,
                -1
              ),
              editing: props.editing,
            }}
          >
            <Canvas />
          </CanvasHostContext.Provider>
        );
    }

    return inner;
  },
  // Always change if editing.
  // Otherwise, only change if content changed.
  (prev, next) => {
    return prev.editing === next.editing && prev.content === next.content;
  }
);
