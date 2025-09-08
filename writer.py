# written by chat
import tempfile
from typing import Optional, cast

import pygit2


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
            if entry.filemode == pygit2.GIT_FILEMODE_TREE:
                subtree = self.repo[entry.oid]
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
            if e.filemode != pygit2.GIT_FILEMODE_TREE:  # type: ignore
                raise KeyError(f"Path component is not a directory: {name}")
            current = self.repo[e.oid]  # type: ignore
        return current  # type: ignore

    def _write_tree_with_update(
        self,
        base_tree: Optional[pygit2.Tree],
        path_parts: list[str],
        leaf_blob_oid: pygit2.Oid,
    ) -> pygit2.Oid:
        """
        Return a new tree OID equal to base_tree but with file at /path_parts updated to leaf_blob_oid.
        Creates any missing directories along the way.
        """
        # If no more parts, we’re at the leaf (filename) — build/modify a tree with the file entry.
        if len(path_parts) == 1:
            filename = path_parts[0]
            builder = (
                self.repo.TreeBuilder(base_tree)
                if base_tree
                else self.repo.TreeBuilder()
            )
            # Insert/replace filename -> blob
            builder.insert(filename, leaf_blob_oid, pygit2.GIT_FILEMODE_BLOB)
            return builder.write()

        # Otherwise, handle the next directory component and recurse
        dirname = path_parts[0]
        # Load current subtree if it exists and is a directory
        sub_tree_obj = None
        if base_tree is not None:
            entry = next((e for e in base_tree if e.name == dirname), None)
            if entry is not None:
                if entry.filemode != pygit2.GIT_FILEMODE_TREE:
                    # Existing non-directory at this path; overwrite with a new directory
                    sub_tree_obj = None
                else:
                    sub_tree_obj = self.repo[entry.oid]

        # Recurse into (existing or new) subtree
        new_subtree_oid = self._write_tree_with_update(
            sub_tree_obj, path_parts[1:], leaf_blob_oid  # type: ignore
        )

        # Rebuild this level’s tree with updated subtree entry
        builder = (
            self.repo.TreeBuilder(base_tree) if base_tree else self.repo.TreeBuilder()
        )
        builder.insert(dirname, new_subtree_oid, pygit2.GIT_FILEMODE_TREE)
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

        if entry.filemode == pygit2.GIT_FILEMODE_TREE:  # type: ignore
            raise KeyError(f"Path is a directory: {path}")

        blob = self.repo[entry.oid]  # type: ignore
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
            self.ref, sig, sig, commit_msg, new_tree_oid, [commit.oid]
        )

        # Push the updated ref to the remote
        if push:
            # Force-update disabled by default; add '+' in refspec if you need non-FF updates
            self.remote.push([self.ref], callbacks=self.callbacks)

        return str(new_commit_oid)


if __name__ == "__main__":
    # DEMO (read-only unless you keep `push=True` and have permission):
    uri = "https://github.com/libgit2/pygit2.git"
    r = Remote(uri)  # , ref="refs/heads/master")

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
