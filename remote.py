# written by chat
import tempfile
from typing import Optional, cast

import pygit2

GITMODE_TREE = pygit2.GIT_FILEMODE_TREE  # type: ignore
GITMODE_FILE = pygit2.GIT_FILEMODE_BLOB  # type: ignore


class Remote:
    def __init__(
        self, uri: str, ref: str = "refs/heads/main", token: Optional[str] = None
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

    def _get_commit(self) -> pygit2.Commit:
        oid = self.repo.lookup_reference(self.ref).target
        return cast(pygit2.Commit, self.repo[oid])

    def _tree_to_dict(self, tree: pygit2.Tree) -> dict[str, Optional[dict]]:
        out: dict[str, Optional[dict]] = {}
        for entry in tree:
            if entry.filemode == GITMODE_TREE:
                subtree = self.repo[entry.id]
                out[entry.name] = self._tree_to_dict(subtree)  # type: ignore
            else:
                out[entry.name] = None  # type: ignore
        return out

    def _walk_to_tree(self, tree: pygit2.Tree, parts: list[str]) -> pygit2.Tree:
        """
        Resolve a subtree by parts (all but the final filename).
        Raises KeyError if a path component is a file or missing.
        """
        current = tree
        for name in parts:
            try:
                e = current[name]  # type: ignore
            except KeyError:
                raise KeyError(f"Directory not found: {'/'.join(parts)}")
            if e.filemode != GITMODE_TREE:
                raise KeyError(f"Path component is not a directory: {name}")
            current = self.repo[e.id]
        return current  # type: ignore

    def _write_tree_with_update(
        self,
        base_tree: Optional[pygit2.Tree],
        path_parts: list[str],
        leaf_blob_oid: pygit2.Oid,
        leaf_mode: int = GITMODE_FILE,
    ) -> pygit2.Oid:
        """
        Return a new tree OID equal to base_tree but with file at /path_parts updated to leaf_blob_oid.
        Creates any missing directories along the way.
        `leaf_mode` lets us preserve file mode (e.g., executable bit) when renaming.
        """
        if len(path_parts) == 1:
            filename = path_parts[0]
            builder = (
                self.repo.TreeBuilder(base_tree)
                if base_tree
                else self.repo.TreeBuilder()
            )
            builder.insert(filename, leaf_blob_oid, leaf_mode)
            return builder.write()

        dirname = path_parts[0]
        sub_tree_obj = None
        if base_tree is not None:
            entry = next((e for e in base_tree if e.name == dirname), None)
            if entry is not None:
                if entry.filemode != GITMODE_TREE:
                    sub_tree_obj = None  # overwrite non-dir with new dir
                else:
                    sub_tree_obj = self.repo[entry.id]

        new_subtree_oid = self._write_tree_with_update(
            sub_tree_obj, path_parts[1:], leaf_blob_oid, leaf_mode  # type: ignore
        )
        builder = (
            self.repo.TreeBuilder(base_tree) if base_tree else self.repo.TreeBuilder()
        )
        builder.insert(dirname, new_subtree_oid, GITMODE_TREE)
        return builder.write()

    # -----------------------
    # Public API
    # -----------------------

    def get_files(self) -> dict[str, Optional[dict]]:
        """Return a nested dict representing the file tree at the tip of self.ref."""
        commit = self._get_commit()
        return self._tree_to_dict(commit.tree)

    def get_file_content(self, path: str) -> str:
        """
        Return file content at given path in the tip commit.
        Raises KeyError if the path is missing or is a directory.
        """
        commit = self._get_commit()
        tree = commit.tree
        parts = [p for p in path.split("/") if p]

        if not parts:
            raise KeyError("Empty path")

        if len(parts) > 1:
            parent_tree = self._walk_to_tree(tree, parts[:-1])
        else:
            parent_tree = tree

        try:
            entry = parent_tree[parts[-1]]
        except KeyError:
            raise KeyError(f"File not found: {path}")

        if entry.filemode == GITMODE_TREE:  # type: ignore
            raise KeyError(f"Path is a directory: {path}")

        blob = self.repo[entry.id]
        return blob.data.decode("utf-8", errors="replace")  # type: ignore

    def update_file_content(
        self,
        path: str,
        new_content: str,
        author_name: str = "Stateless Bot",
        author_email: str = "noreply@example.com",
        message: Optional[str] = None,
        push: bool = True,
    ) -> str:
        """
        Create a new commit that updates/creates `path` with `new_content`, then (optionally) push.

        Returns the new commit SHA.
        """
        commit = self._get_commit()
        base_tree = commit.tree

        # Create/replace blob
        blob_oid = self.repo.create_blob(new_content.encode("utf-8"))

        # Build a new tree, creating intermediate directories as needed
        parts = [p for p in path.split("/") if p]
        new_tree_oid = self._write_tree_with_update(base_tree, parts, blob_oid)

        # Create commit (advancing local ref)
        sig = pygit2.Signature(author_name, author_email)
        commit_msg = message or f"Update {path}"
        new_commit_oid = self.repo.create_commit(
            self.ref, sig, sig, commit_msg, new_tree_oid, [commit.id]
        )

        # Push the updated ref to the remote
        if push:
            # Force-update disabled by default; add '+' in refspec if you need non-FF updates
            self.remote.push([self.ref], callbacks=self.callbacks)

        return str(new_commit_oid)

    # -----------------------
    # New: create & delete
    # -----------------------

    def create_file(
        self,
        path: str,
        content: str,
        author_name: str = "Stateless Bot",
        author_email: str = "noreply@example.com",
        message: Optional[str] = None,
        push: bool = True,
        fail_if_exists: bool = True,
    ) -> str:
        """
        Create a new file at `path` with `content`. Creates intermediate directories.
        If `fail_if_exists` and the file already exists, raises KeyError.
        Returns the new commit SHA.
        """
        commit = self._get_commit()
        base_tree = commit.tree

        parts = [p for p in path.split("/") if p]
        if not parts:
            raise KeyError("Empty path")

        # Existence check
        try:
            parent = (
                base_tree
                if len(parts) == 1
                else self._walk_to_tree(base_tree, parts[:-1])
            )
            if parts[-1] in {e.name for e in parent}:
                if fail_if_exists:
                    raise KeyError(f"File already exists: {path}")
        except KeyError:
            # parent directory may not exist; we'll create it below
            pass

        blob_oid = self.repo.create_blob(content.encode("utf-8"))
        new_tree_oid = self._write_tree_with_update(base_tree, parts, blob_oid)

        sig = pygit2.Signature(author_name, author_email)
        commit_msg = message or f"Create {path}"
        new_commit_oid = self.repo.create_commit(
            self.ref, sig, sig, commit_msg, new_tree_oid, [commit.id]
        )

        if push:
            callbacks = pygit2.RemoteCallbacks()
            self.remote.push([self.ref], callbacks=callbacks)

        return str(new_commit_oid)

    def delete_file(
        self,
        path: str,
        author_name: str = "Stateless Bot",
        author_email: str = "noreply@example.com",
        message: Optional[str] = None,
        push: bool = True,
    ) -> str:
        """
        Delete the file at `path`. Raises KeyError if not found or if path is a directory.
        Returns the new commit SHA.
        """
        commit = self._get_commit()
        base_tree = commit.tree
        parts = [p for p in path.split("/") if p]
        if not parts:
            raise KeyError("Empty path")

        new_tree_oid_or_none = self._write_tree_with_delete(base_tree, parts)
        if new_tree_oid_or_none is None:
            # Repository would have an empty root tree; create an empty tree object
            builder = self.repo.TreeBuilder()
            new_tree_oid = builder.write()
        else:
            new_tree_oid = new_tree_oid_or_none

        sig = pygit2.Signature(author_name, author_email)
        commit_msg = message or f"Delete {path}"
        new_commit_oid = self.repo.create_commit(
            self.ref, sig, sig, commit_msg, new_tree_oid, [commit.id]
        )

        if push:
            callbacks = pygit2.RemoteCallbacks()
            self.remote.push([self.ref], callbacks=callbacks)

        return str(new_commit_oid)

    # -----------------------
    # New: internal helper for delete
    # -----------------------
    def _write_tree_with_delete(
        self,
        base_tree: Optional[pygit2.Tree],
        path_parts: list[str],
    ) -> Optional[pygit2.Oid]:
        """
        Return a new tree OID equal to base_tree but with the file at /path_parts removed.
        Returns None if the resulting tree is empty (so caller can prune the parent).
        Raises KeyError if the path doesn't exist or a component isn't a directory.
        """
        if base_tree is None:
            raise KeyError("Path not found")

        name = path_parts[0]
        try:
            entry = base_tree[name]
        except KeyError:
            raise KeyError(f"Path not found: {'/'.join(path_parts)}")

        builder = self.repo.TreeBuilder(base_tree)

        if len(path_parts) == 1:
            # Leaf
            if entry.filemode == GITMODE_TREE:
                raise KeyError(f"Path is a directory: {'/'.join(path_parts)}")
            builder.remove(name)
            new_oid = builder.write()
            return None if len(self.repo[new_oid]) == 0 else new_oid  # type: ignore

        # Recurse into subtree
        if entry.filemode != GITMODE_TREE:
            raise KeyError(f"Path component is not a directory: {name}")
        new_subtree_oid = self._write_tree_with_delete(
            self.repo[entry.id], path_parts[1:]  # type: ignore
        )
        if new_subtree_oid is None:
            # Child became empty; remove it
            builder.remove(name)
        else:
            builder.insert(name, new_subtree_oid, GITMODE_TREE)

        new_oid = builder.write()
        return None if len(self.repo[new_oid]) == 0 else new_oid  # type: ignore

    def rename_file(
        self,
        src_path: str,
        dst_path: str,
        author_name: str = "Stateless Bot",
        author_email: str = "noreply@example.com",
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

        commit = self._get_commit()
        base_tree = commit.tree

        src_parts = [p for p in src_path.split("/") if p]
        dst_parts = [p for p in dst_path.split("/") if p]
        if not src_parts or not dst_parts:
            raise KeyError("Invalid path")

        # Resolve source entry (must be a file)
        if len(src_parts) > 1:
            src_parent = self._walk_to_tree(base_tree, src_parts[:-1])
        else:
            src_parent = base_tree

        try:
            src_entry = src_parent[src_parts[-1]]
        except KeyError:
            raise KeyError(f"Source not found: {src_path}")

        if src_entry.filemode == GITMODE_TREE:
            raise KeyError(f"Source is a directory (not supported): {src_path}")

        blob_oid = src_entry.id
        leaf_mode = src_entry.filemode  # preserve mode (executable bit, etc.)

        # Check destination existence
        try:
            if len(dst_parts) > 1:
                dst_parent_tree = self._walk_to_tree(base_tree, dst_parts[:-1])
            else:
                dst_parent_tree = base_tree
            if dst_parts[-1] in {e.name for e in dst_parent_tree}:
                if fail_if_exists:
                    raise KeyError(f"Destination already exists: {dst_path}")
                # else we'll overwrite below
        except KeyError:
            # parent dirs may not exist; we'll create them in _write_tree_with_update
            pass

        # 1) Remove source
        after_delete_tree_oid_or_none = self._write_tree_with_delete(
            base_tree, src_parts
        )
        if after_delete_tree_oid_or_none is None:
            builder = self.repo.TreeBuilder()
            after_delete_tree_oid = builder.write()
        else:
            after_delete_tree_oid = after_delete_tree_oid_or_none

        # 2) Insert at destination (create dirs as needed), preserving mode
        after_delete_tree = self.repo[after_delete_tree_oid]
        new_tree_oid = self._write_tree_with_update(
            after_delete_tree, dst_parts, blob_oid, leaf_mode  # type: ignore
        )

        # Commit
        sig = pygit2.Signature(author_name, author_email)
        commit_msg = message or f"Rename {src_path} -> {dst_path}"
        new_commit_oid = self.repo.create_commit(
            self.ref, sig, sig, commit_msg, new_tree_oid, [commit.id]
        )

        if push:
            callbacks = pygit2.RemoteCallbacks()
            self.remote.push([self.ref], callbacks=callbacks)

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
