import React, { useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { getEventListener } from "./pasteAsHTML";

type EditorProps = {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
};

export const Editor: React.FC<EditorProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const listener = getEventListener();
    document.addEventListener("paste", listener);
    return () => {
      document.removeEventListener("paste", listener);
    };
  }, []);

  return (
    <div
      className="editor-wrap"
      style={{ display: "flex", flexDirection: "row" }}
    >
      {/* Textarea */}
      <div style={{ flex: 1 }} className="textarea">
        <textarea
          ref={textareaRef}
          style={{
            paddingBottom: "50vh",
            paddingLeft: "12px",
            paddingTop: "12px",
            paddingRight: "12px",
            height: "100%",
            width: "100%",
            border: 0,
          }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault();

              document.execCommand("insertText", false, "  ");
            }
          }}
        />
      </div>
      {/* Markdown preview */}
      <div
        style={{ flex: 1, borderLeft: 0, overflowY: "auto" }}
        className="textarea"
      >
        <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {value}
        </Markdown>
      </div>
    </div>
  );
};
