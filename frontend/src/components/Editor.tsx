import React from "react";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

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
  return (
    <div
      className="editor-wrap"
      style={{ display: "flex", flexDirection: "row" }}
    >
      {/* Textarea */}
      <div style={{ flex: 1 }}>
        <textarea
          className="textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          disabled={disabled}
        />
      </div>
      {/* Markdown preview */}
      <div style={{ flex: 1, borderLeft: 0 }} className="textarea">
        <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {value}
        </Markdown>
      </div>
    </div>
  );
};
