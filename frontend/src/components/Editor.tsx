import React from "react";

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
    <div className="editor-wrap">
      <textarea
        className="textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        disabled={disabled}
      />
    </div>
  );
};
