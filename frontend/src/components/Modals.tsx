import React from "react";

export const Modal: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, onClose, children }) => {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
};

export const CreateFileModal: React.FC<{
  onSubmit: (
    path: string,
    content: string,
    message?: string,
    failIfExists?: boolean
  ) => void;
  onClose: () => void;
}> = ({ onSubmit, onClose }) => {
  const [path, setPath] = React.useState("");
  const [content, setContent] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [fail, setFail] = React.useState(true);

  return (
    <Modal title="Create file" onClose={onClose}>
      <div className="row">
        <label>Path</label>
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="e.g. src/new.txt"
        />
      </div>
      <div className="row">
        <label>Message</label>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message (optional)"
        />
      </div>
      <div className="row">
        <label>Content</label>
        <textarea
          rows={6}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>
      <div className="row" style={{ alignItems: "center" }}>
        <label>Options</label>
        <label style={{ display: "flex", gap: 6 }}>
          <input
            type="checkbox"
            checked={fail}
            onChange={() => setFail(!fail)}
          />{" "}
          fail if exists
        </label>
      </div>
      <div className="actions">
        <button className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          onClick={() =>
            onSubmit(path.trim(), content, message.trim() || undefined, fail)
          }
        >
          Create
        </button>
      </div>
    </Modal>
  );
};

export const RenameFileModal: React.FC<{
  srcPath: string;
  onSubmit: (dst: string, message?: string, failIfExists?: boolean) => void;
  onClose: () => void;
}> = ({ srcPath, onSubmit, onClose }) => {
  const [dst, setDst] = React.useState(srcPath);
  const [message, setMessage] = React.useState("");
  const [fail, setFail] = React.useState(true);

  return (
    <Modal title="Rename file" onClose={onClose}>
      <div className="row">
        <label>From</label>
        <input type="text" value={srcPath} readOnly />
      </div>
      <div className="row">
        <label>To</label>
        <input
          type="text"
          value={dst}
          onChange={(e) => setDst(e.target.value)}
        />
      </div>
      <div className="row">
        <label>Message</label>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message (optional)"
        />
      </div>
      <div className="row" style={{ alignItems: "center" }}>
        <label>Options</label>
        <label style={{ display: "flex", gap: 6 }}>
          <input
            type="checkbox"
            checked={fail}
            onChange={() => setFail(!fail)}
          />{" "}
          fail if exists
        </label>
      </div>
      <div className="actions">
        <button className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          onClick={() =>
            onSubmit(dst.trim(), message.trim() || undefined, fail)
          }
        >
          Rename
        </button>
      </div>
    </Modal>
  );
};

export const DeleteFileModal: React.FC<{
  path: string;
  onSubmit: () => void;
  onClose: () => void;
}> = ({ path, onSubmit, onClose }) => {
  return (
    <Modal title="Delete file" onClose={onClose}>
      <p>Are you sure you want to delete:</p>
      <p style={{ fontWeight: 700 }}>{path}</p>
      <div className="actions">
        <button className="button" onClick={onClose}>
          Cancel
        </button>
        <button className="button danger" onClick={onSubmit}>
          Delete
        </button>
      </div>
    </Modal>
  );
};

export const AuthModal: React.FC<{
  onSubmit: (token: string) => void;
  onClose: () => void;
}> = ({ onSubmit, onClose }) => {
  const [token, setToken] = React.useState("");

  return (
    <Modal title="Authentication" onClose={onClose}>
      <div className="row">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Token"
        />
      </div>
      <div className="actions">
        <button className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          onClick={() => onSubmit(token.trim())}
        >
          Save
        </button>
      </div>
    </Modal>
  );
};
