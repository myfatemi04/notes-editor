import tempfile
from typing import Optional, cast

import pygit2

GITMODE_TREE = pygit2.GIT_FILEMODE_TREE  # type: ignore
GITMODE_FILE = pygit2.GIT_FILEMODE_BLOB  # type: ignore


class Remote:
    def __init__(
        self,
        uri: str,
        ref: str = "refs/heads/main",
        token: Optional[str] = None,
        author_name: str = "Stateless Bot",
        author_email: str = "noreply@example.com",
    ):
        """
        Stateless Git remote viewer/editor built on libgit2 (pygit2).

        - Creates a bare repo in a temp dir (no checkout).
        - Shallow-fetches a single ref (depth=1).
        - Works best for read-mostly UIs; pushes minimal objects for edits.

        NOTE: For private remotes, pass RemoteCallbacks with creds as needed.
        """
        self.uri = uri
        self.ref = ref
        self._tmpdir = tempfile.mkdtemp(prefix="stateless-bare-")
        self.repo = pygit2.init_repository(self._tmpdir, bare=True)

        # Create/lookup remote
        try:
            self.remote = self.repo.remotes.create("origin", uri)
        except ValueError:
            self.remote = self.repo.remotes["origin"]

        # Shallow fetch the chosen ref (tip commit + reachable objects).
        # (Partial clone filters are not yet universally available in pygit2.)
        self.callbacks = pygit2.RemoteCallbacks(
            # x-access-token can be anything; Github ignores it
            credentials=pygit2.UserPass("x-access-token", token) if token else None
        )
        self.remote.fetch([self.ref], depth=1, callbacks=self.callbacks)
        self.author_name = author_name
        self.author_email = author_email

        # Ensure we have a local ref pointing at the fetched tip
        self._ensure_tracking_ref()

    def _ensure_tracking_ref(self):
        remote_ref = f"refs/remotes/origin/{self.ref.split('/')[-1]}"
        # If refs/heads/<name> is missing, create it at the remote tip
        if self.ref not in self.repo.references:
            if remote_ref not in self.repo.references:
                # Fall back to reading FETCH_HEAD
                fetch_head = self.repo.lookup_reference("FETCH_HEAD").target
                self.repo.references.create(self.ref, fetch_head, force=True)
            else:
                self.repo.references.create(
                    self.ref, self.repo.lookup_reference(remote_ref).target, force=True
                )

    def _get_tip(self) -> pygit2.Commit:
        oid = self.repo.lookup_reference(self.ref).target
        return cast(pygit2.Commit, self.repo[oid])

    def _new_commit(
        self, message: str, prev: pygit2.Commit, tree: pygit2.Tree
    ) -> pygit2.Commit:
        sig = pygit2.Signature(self.author_name, self.author_email)
        new_commit_oid = self.repo.create_commit(
            self.ref, sig, sig, message, tree.id, [prev.id]
        )
        return cast(pygit2.Commit, self.repo[new_commit_oid])

    def _tree_to_dict(self, tree: pygit2.Tree) -> dict[str, Optional[dict]]:
        out: dict[str, Optional[dict]] = {}
        for entry in tree:
            if entry.filemode == GITMODE_TREE:
                subtree = self.repo[entry.id]
                out[entry.name] = self._tree_to_dict(subtree)  # type: ignore
            else:
                out[entry.name] = None  # type: ignore
        return out

    def _deep_update(
        self, base_tree: pygit2.Tree, parts: list[str], update: dict
    ) -> pygit2.Oid:
        """Recurs down tree with DFS, returning OID of updated tree."""

        if len(parts) == 1:
            if update["type"] == "delete":
                filename = parts[0]
                print(f"Deleting {filename}")
                builder = self.repo.TreeBuilder(base_tree)
                builder.remove(filename)
                return builder.write()
            elif update["type"] == "insert":
                filename = parts[0]
                file_exists = filename in {e.name for e in base_tree}
                if update.get("fail_if_not_exists") and not file_exists:
                    raise KeyError(f"File not found: {filename}")
                if update.get("fail_if_exists") and file_exists:
                    raise KeyError(f"File already exists: {filename}")
                print(f"Inserting {filename}")
                builder = self.repo.TreeBuilder(base_tree)
                builder.insert(filename, update["blob_oid"], update["mode"])
                return builder.write()

        next_dir_node = next((e for e in base_tree if e.name == parts[0]), None)
        if next_dir_node is None:
            if update["type"] == "delete":
                raise KeyError(f"Path not found: {'/'.join(parts)}")

            next_dir_oid = self.repo.TreeBuilder().write()
            next_dir_tree_builder = self.repo.TreeBuilder(base_tree)
            next_dir_tree_builder.insert(parts[0], next_dir_oid, GITMODE_TREE)
            updated_base_tree_oid = next_dir_tree_builder.write()
            base_tree = cast(pygit2.Tree, self.repo[updated_base_tree_oid])
            next_dir_node = self.repo[next_dir_oid]
        elif next_dir_node.filemode != GITMODE_TREE:
            raise KeyError(f"Path component is not a directory: {parts[0]}")

        assert isinstance(next_dir_node, pygit2.Tree)

        new_tree_oid = self._deep_update(next_dir_node, parts[1:], update)
        builder = self.repo.TreeBuilder(base_tree)
        builder.insert(parts[0], new_tree_oid, GITMODE_TREE)
        return builder.write()

    # -----------------------
    # Public API
    # -----------------------

    def get_files(self) -> dict[str, Optional[dict]]:
        """Return a nested dict representing the file tree at the tip of self.ref."""
        commit = self._get_tip()
        return self._tree_to_dict(commit.tree)

    def _push(self):
        self.remote.push([self.ref], callbacks=self.callbacks)

    def _get_file_blob(self, tree: pygit2.Tree, path: str) -> pygit2.Blob:
        node = tree
        parts = [p for p in path.split("/") if p]
        for part in parts:
            if not isinstance(node, pygit2.Tree):
                # should be non-leaf here
                raise KeyError(f"Path component is not a directory: {part}")
            try:
                node = node[part]
            except KeyError:
                raise KeyError(f"File not found: {path}")

        if node.filemode != GITMODE_FILE:
            raise KeyError(f"Path is not a file: {path}")

        return cast(pygit2.Blob, node)

    def get_file_content(self, path: str) -> str:
        """
        Return file content at given path in the tip commit.
        Raises KeyError if the path is missing or is a directory.
        """
        commit = self._get_tip()
        tree = commit.tree
        return self._get_file_blob(tree, path).data.decode("utf-8", errors="replace")

    def update_file_content(
        self,
        path: str,
        content: str,
        fail_if_exists: bool,
        fail_if_not_exists: bool,
        message: Optional[str] = None,
        push: bool = True,
    ) -> str:
        """
        Create a new commit that updates/creates `path` with `new_content`, then (optionally) push.

        Returns the new commit SHA.
        """
        commit = self._get_tip()
        base_tree = commit.tree

        blob_oid = self.repo.create_blob(content.encode("utf-8"))
        new_tree_oid = self._deep_update(
            base_tree,
            parts=[p for p in path.split("/") if p],
            update={
                "type": "insert",
                "blob_oid": blob_oid,
                "mode": GITMODE_FILE,
                "fail_if_exists": fail_if_exists,
                "fail_if_not_exists": fail_if_not_exists,
            },
        )
        commit_msg = message or f"Update {path}"
        new_commit_oid = self._new_commit(
            commit_msg, commit, cast(pygit2.Tree, self.repo[new_tree_oid])
        )
        if push:
            self._push()

        return str(new_commit_oid)

    def delete_file(
        self,
        path: str,
        message: Optional[str] = None,
        push: bool = True,
    ) -> str:
        """
        Delete the file at `path`. Raises KeyError if not found or if path is a directory.
        Returns the new commit SHA.
        """
        commit = self._get_tip()
        base_tree = commit.tree
        new_tree_oid = self._deep_update(
            base_tree,
            parts=[p for p in path.split("/") if p],
            update={"type": "delete"},
        )
        commit_msg = message or f"Delete {path}"
        new_commit_oid = self._new_commit(
            commit_msg, commit, cast(pygit2.Tree, self.repo[new_tree_oid])
        )
        if push:
            self._push()

        return str(new_commit_oid)

    def rename_file(
        self,
        src_path: str,
        dst_path: str,
        message: Optional[str] = None,
        push: bool = True,
        fail_if_exists: bool = True,
    ) -> str:
        """
        Rename (move) a file from `src_path` to `dst_path`.
        - Preserves the blob and file mode (e.g., executable bit).
        - Creates intermediate directories for the destination path.
        - If `fail_if_exists` and destination exists, raises KeyError.
        Returns the new commit SHA.
        """
        if not src_path or not dst_path:
            raise KeyError("src_path and dst_path are required")

        commit = self._get_tip()
        base_tree = commit.tree
        new_tree_oid = self._deep_update(
            base_tree,
            dst_path.split("/"),
            {
                "type": "insert",
                "blob_oid": self._get_file_blob(base_tree, src_path).id,
                "mode": GITMODE_FILE,
                "fail_if_exists": fail_if_exists,
            },
        )
        new_commit_oid = self._new_commit(
            message or f"Rename {src_path} to {dst_path}",
            commit,
            cast(pygit2.Tree, self.repo[new_tree_oid]),
        )

        if push:
            self._push()

        return str(new_commit_oid)


if __name__ == "__main__":
    # DEMO (read-only unless you keep `push=True` and have permission):
    uri = "https://github.com/libgit2/pygit2.git"
    r = Remote(uri, ref="refs/heads/master")

    # 1) list files (nested dict)
    files = r.get_files()
    print(list(files.keys())[:10])

    # 2) Read a nested file
    try:
        content = r.get_file_content("README.md")
        print(content.splitlines()[0])
    except KeyError as e:
        print(e)

    # 3) Update or create a deeply nested file (CAUTION: pushes if allowed!)
    # new_sha = r.update_file_content("docs/examples/hello.txt", "Hello, world!\n", push=False)
    # print("New commit:", new_sha)
