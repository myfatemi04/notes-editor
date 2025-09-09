import React, { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
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
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewLayout, setPreviewLayout] = useState<"side-by-side" | "bottom">(
    "side-by-side"
  );

  useEffect(() => {
    const pasteListener = getEventListener();
    const screenResizeListener = () => {
      if (window.innerWidth < window.screen.width * 0.6) {
        setPreviewLayout("bottom");
      } else {
        setPreviewLayout("side-by-side");
      }
    };

    document.addEventListener("paste", pasteListener);
    window.addEventListener("resize", screenResizeListener);
    return () => {
      document.removeEventListener("paste", pasteListener);
      window.removeEventListener("resize", screenResizeListener);
    };
  }, []);

  // Scroll listener: make preview stick to bottom if textarea is at bottom
  useEffect(() => {
    const el = textareaRef.current;
    const preview = previewRef.current;
    if (!el || !preview) return;

    const scrollListener = () => {
      if (el.scrollHeight - el.scrollTop < el.clientHeight + 20) {
        preview.scrollTop = preview.scrollHeight;
        return;
      }
    };

    el.addEventListener("scroll", scrollListener);
    el.addEventListener("input", scrollListener);
    return () => {
      el.removeEventListener("scroll", scrollListener);
      el.removeEventListener("input", scrollListener);
    };
  }, []);

  return (
    <div
      className="editor-wrap"
      style={{
        display: "flex",
        flexDirection: previewLayout === "side-by-side" ? "row" : "column",
      }}
    >
      {/* Textarea */}
      <div style={{ flex: 1 }} className="textarea">
        <textarea
          ref={textareaRef}
          style={{
            paddingBottom: previewLayout === "side-by-side" ? "50vh" : "12px",
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
        style={{
          flex: 1,
          borderLeft: previewLayout === "side-by-side" ? 0 : undefined,
          borderTop: previewLayout === "bottom" ? 0 : undefined,
          overflowY: "auto",
          // Switch to something easier on the eyes
          fontFamily: "sans-serif",
        }}
        className="textarea"
        ref={previewRef}
      >
        <Markdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
        >
          {value}
        </Markdown>
      </div>
    </div>
  );
};
