import React from "react";
import { FileTree } from "../lib/types";

type NodeProps = {
  name: string;
  subtree: FileTree | null;
  prefix: string[];
  onOpen: (path: string) => void;
};

const TreeNode: React.FC<NodeProps> = ({ name, subtree, prefix, onOpen }) => {
  const [open, setOpen] = React.useState<boolean>(false);
  const isDir = subtree !== null;
  const fullPath = [...prefix, name].join("/");

  return (
    <li>
      <div
        className="tree-item"
        onClick={() => (isDir ? setOpen(!open) : onOpen(fullPath))}
        title={isDir ? (open ? "Collapse" : "Expand") : "Open file"}
      >
        <span>{isDir ? (open ? "▾" : "▸") : "•"}</span>
        <span
          style={{ minWidth: 12, display: "inline-block", textAlign: "center" }}
        >
          {isDir ? "DIR" : "TXT"}
        </span>
        <span>{name}</span>
      </div>
      {isDir && open && subtree && (
        <ul>
          {Object.entries(subtree)
            .sort((a, b) => {
              // dirs first, then files, then name asc
              const aIsDir = a[1] !== null ? 0 : 1;
              const bIsDir = b[1] !== null ? 0 : 1;
              if (aIsDir !== bIsDir) return aIsDir - bIsDir;
              return a[0].localeCompare(b[0]);
            })
            .map(([child, childTree]) => (
              <TreeNode
                key={child}
                name={child}
                subtree={childTree}
                prefix={[...prefix, name]}
                onOpen={onOpen}
              />
            ))}
        </ul>
      )}
    </li>
  );
};

export const FileTreeView: React.FC<{
  tree: FileTree;
  onOpen: (path: string) => void;
}> = ({ tree, onOpen }) => {
  return (
    <div className="tree">
      <ul>
        {Object.entries(tree).map(([name, subtree]) => (
          <TreeNode
            key={name}
            name={name}
            subtree={subtree}
            prefix={[]}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </div>
  );
};
