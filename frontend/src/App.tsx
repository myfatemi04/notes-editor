import { useEffect, useState } from "react";
import BlockEditor from "./components/BlockEditor";
import { FileTreeView } from "./components/FileTree";
import {
  AuthModal,
  CreateFileModal,
  DeleteFileModal,
  RenameFileModal,
} from "./components/Modals";
import { api, setAccessToken } from "./lib/api";
import { FileTree } from "./lib/types";
import Dag from "./components/Dag";
import Canvas from "./components/Canvas";

export default function App() {
  const [tree, setTree] = useState<FileTree | null>(null);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [content, setContent] = useState<string>("");

  const [savedContent, setSavedContent] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [showSidebar, setShowSidebar] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  const dirty = content !== savedContent && currentPath.length > 0;

  // Warn for unsaved changes.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue =
          "Are you sure you want to leave? You have unsaved changes.";
        return e.returnValue;
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function refreshTree(keepPath?: string) {
    try {
      const data = await api.listFiles();
      setTree(data.files);
      if (keepPath) {
        // best-effort: if we still have the file open, keep it
        try {
          const res = await api.getFile(keepPath);
          setCurrentPath(keepPath);
          setContent(res.content ?? "");
          setSavedContent(res.content ?? "");
        } catch {
          /* ignore */
        }
      }
    } catch (e: any) {
      setError(e.message || String(e));
    }
  }

  useEffect(() => {
    void refreshTree();
  }, []);

  async function openFile(path: string) {
    setLoading(true);
    setError("");
    try {
      const data = await api.getFile(path);
      setCurrentPath(path);
      setContent(data.content ?? "");
      setSavedContent(data.content ?? "");
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveFile() {
    if (!currentPath || !dirty) return;
    setSaving(true);
    setError("");
    try {
      await api.saveFile({
        path: currentPath,
        content,
        message: `Edit ${currentPath}`,
      });
      setSavedContent(content);
      // optional: refresh tree if needed (not required for content changes)
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  // Shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveFile();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [content, currentPath, dirty]);

  const crumbs = currentPath ? currentPath.split("/").filter(Boolean) : [];

  return (
    <div className="app">
      <div className="header">
        <div className="brand">Notes</div>
        <div className="toolbar">
          <button
            className="button"
            onClick={() => setShowSidebar(!showSidebar)}
          >
            {showSidebar ? "Hide" : "Show"} Sidebar
          </button>
          <button
            className="button"
            onClick={() => void refreshTree(currentPath)}
          >
            Refresh
          </button>
          <button className="button" onClick={() => setShowCreate(true)}>
            New File
          </button>
          <button
            className="button"
            onClick={() => setShowRename(true)}
            disabled={!currentPath}
          >
            Rename
          </button>
          <button
            className="button danger"
            onClick={() => setShowDelete(true)}
            disabled={!currentPath}
          >
            Delete
          </button>
          <button className="button" onClick={() => setShowAuth(true)}>
            Authenticate
          </button>
          <button
            className="button primary"
            onClick={saveFile}
            disabled={!dirty || saving}
          >
            {saving ? "Saving..." : "Save (⌘/Ctrl+S)"}
          </button>
        </div>
      </div>

      <aside
        className="sidebar"
        style={{ display: showSidebar ? "block" : "none" }}
      >
        {tree ? (
          <FileTreeView tree={tree} onOpen={openFile} />
        ) : (
          <div style={{ padding: 12 }}>Loading tree…</div>
        )}
      </aside>

      <main
        className="main"
        style={{ gridColumn: !showSidebar ? "1 / -1" : undefined }}
      >
        <div className="pathbar">
          <span>Path:</span>
          {currentPath ? (
            <>
              {crumbs.map((c, i) => (
                <span
                  key={i}
                  className={`crumb ${i === crumbs.length - 1 ? "active" : ""}`}
                >
                  {i > 0 && <span style={{ margin: "0 6px" }}>/</span>}
                  {c}
                </span>
              ))}
              {dirty && <span className="badge warn">unsaved</span>}
            </>
          ) : (
            <span className="crumb">— Select a file</span>
          )}
        </div>

        <BlockEditor
          key={currentPath} // reset editor state when switching files
          content={content}
          setContent={setContent}
          disabled={!currentPath || loading}
          components={{
            pre: ({ children, node }) => {
              const code = (children.props.children ?? "").replace(/\\`/g, "`");
              const classes = node.children[0].properties.className ?? [];

              if (classes.length === 0) {
                return <pre className="code-pre">{code}</pre>;
              }

              if (classes.length > 0) {
                // Check if a DAG.
                if (classes[0] === "language-dag") {
                  return <Dag code={code} />;
                } else if (classes[0] === "language-canvas") {
                  return <Canvas />;
                }

                return <pre className={`code-pre ${classes[0]}`}>{code}</pre>;
              }
            },
          }}
        />
      </main>

      <footer className="footer">
        <span>Status:</span>
        {error ? (
          <span className="badge warn" title={error}>
            {error}
          </span>
        ) : saving ? (
          <span className="badge">Saving…</span>
        ) : dirty ? (
          <span className="badge warn">Unsaved changes</span>
        ) : currentPath ? (
          <span className="badge">Saved</span>
        ) : (
          <span className="badge">Idle</span>
        )}
      </footer>

      {showCreate && (
        <CreateFileModal
          onClose={() => setShowCreate(false)}
          onSubmit={async (path, initial, message, fail) => {
            try {
              await api.createFile({
                path,
                content: initial,
                message,
                fail_if_exists: fail,
              });
              setShowCreate(false);
              await refreshTree(path);
              setError("");
            } catch (e: any) {
              setError(e.message || String(e));
            }
          }}
        />
      )}

      {showRename && currentPath && (
        <RenameFileModal
          srcPath={currentPath}
          onClose={() => setShowRename(false)}
          onSubmit={async (dst, message, fail) => {
            try {
              await api.renameFile({
                src: currentPath,
                dst,
                message,
                fail_if_exists: fail,
              });
              setShowRename(false);
              await refreshTree(dst);
              setError("");
            } catch (e: any) {
              setError(e.message || String(e));
            }
          }}
        />
      )}

      {showDelete && currentPath && (
        <DeleteFileModal
          path={currentPath}
          onClose={() => setShowDelete(false)}
          onSubmit={async () => {
            try {
              await api.deleteFile(currentPath);
              setShowDelete(false);
              setCurrentPath("");
              setContent("");
              setSavedContent("");
              await refreshTree();
              setError("");
            } catch (e: any) {
              setError(e.message || String(e));
            }
          }}
        />
      )}

      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSubmit={(token) => {
            setAccessToken(token);
            setShowAuth(false);
          }}
        />
      )}
    </div>
  );
}
