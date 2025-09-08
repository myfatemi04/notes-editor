import json
import os
import sys
from typing import Any, Dict, Optional

from remote import (
    Remote,
)  # assumes your earlier Remote class is available and importable


# ---------------------------
# Config (from environment)
# ---------------------------
REMOTE_URI = os.environ.get("REMOTE_URI") or os.environ.get("GIT_REMOTE_URI")
GIT_REF = os.environ.get("GIT_REF", "refs/heads/main")
GITHUB_TOKEN = (
    os.environ.get("GITHUB_TOKEN")
    or os.environ.get("GH_TOKEN")
    or os.environ.get("TOKEN")
)

# CORS settings
CORS_HEADERS = {
    "Access-Control-Allow-Origin": os.environ.get("CORS_ALLOW_ORIGIN", "*"),
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}

# Cache the Remote instance across Lambda invocations
_REMOTE_SINGLETON: Optional[Remote] = None


def _json_response(
    status: int, body: Dict[str, Any], headers: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    h = {"Content-Type": "application/json"}
    h.update(CORS_HEADERS)
    if headers:
        h.update(headers)
    return {"statusCode": status, "headers": h, "body": json.dumps(body)}


def _bad_request(
    message: str, extra: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    payload = {"error": message}
    if extra:
        payload.update(extra)
    return _json_response(400, payload)


def _get_remote() -> Remote:
    """
    Returns a cached Remote instance, constructing it if needed.
    This function is defensive about the Remote constructor signature:
    - Prefer Remote(uri, ref=GIT_REF, token=GITHUB_TOKEN) if available
    - Fallback to Remote(uri, ref=GIT_REF) otherwise
    """
    global _REMOTE_SINGLETON
    if _REMOTE_SINGLETON is not None:
        return _REMOTE_SINGLETON

    if not REMOTE_URI:
        raise RuntimeError("REMOTE_URI environment variable is not set")

    # Try to construct with token if the Remote class supports it.
    try:
        _REMOTE_SINGLETON = Remote(REMOTE_URI, ref=GIT_REF, token=GITHUB_TOKEN)  # type: ignore[arg-type]
    except TypeError:
        # Fallback: constructor without token
        _REMOTE_SINGLETON = Remote(REMOTE_URI, ref=GIT_REF)  # type: ignore[call-arg]

    return _REMOTE_SINGLETON


def _handle_get_files() -> Dict[str, Any]:
    r = _get_remote()
    files = r.get_files()
    return _json_response(200, {"ref": GIT_REF, "files": files})


def _handle_get_file_content(event: Dict[str, Any]) -> Dict[str, Any]:
    qs = event.get("queryStringParameters") or {}
    path = qs.get("path")
    if not path:
        return _bad_request("Missing required query parameter: path")

    r = _get_remote()
    try:
        content = r.get_file_content(path)
    except KeyError as e:
        return _json_response(404, {"error": str(e), "path": path})
    return _json_response(200, {"ref": GIT_REF, "path": path, "content": content})


def _parse_json_body(event: Dict[str, Any]) -> Dict[str, Any]:
    body = event.get("body")
    if body is None:
        return {}
    if event.get("isBase64Encoded"):
        # API Gateway might base64-encode the body; handle if needed.
        import base64

        try:
            body = base64.b64decode(body).decode("utf-8", errors="replace")
        except Exception:
            pass
    try:
        return json.loads(body)
    except Exception:
        return {}


def _handle_update_file_content(event: Dict[str, Any]) -> Dict[str, Any]:
    data = _parse_json_body(event)
    path = data.get("path")
    new_content = data.get("content")
    message = data.get("message")

    if not path or new_content is None:
        return _bad_request("JSON body must include 'path' and 'content'")

    r = _get_remote()
    try:
        new_sha = r.update_file_content(path, new_content, message=message, push=True)
    except KeyError as e:
        # E.g., an intermediate component is not a directory
        return _json_response(400, {"error": str(e), "path": path})
    except Exception as e:
        # Generic failure (auth, push rejected, etc.)
        return _json_response(500, {"error": "Update failed", "detail": str(e)})

    return _json_response(200, {"ref": GIT_REF, "path": path, "commit": new_sha})


def _handle_create_file(event: Dict[str, Any]) -> Dict[str, Any]:
    data = _parse_json_body(event)
    path = data.get("path")
    content = data.get("content", "")
    message = data.get("message")
    fail_if_exists = bool(data.get("fail_if_exists", True))
    if not path:
        return _bad_request("JSON body must include 'path'")
    r = _get_remote()
    try:
        new_sha = r.create_file(
            path, content, message=message, push=True, fail_if_exists=fail_if_exists
        )
    except KeyError as e:
        return _json_response(409, {"error": str(e), "path": path})
    except Exception as e:
        return _json_response(500, {"error": "Create failed", "detail": str(e)})
    return _json_response(200, {"ref": GIT_REF, "path": path, "commit": new_sha})


def _handle_delete_file(event: Dict[str, Any]) -> Dict[str, Any]:
    qs = event.get("queryStringParameters") or {}
    path = qs.get("path")
    if not path:
        # Also support JSON body for DELETE if client can't send query params
        data = _parse_json_body(event)
        path = data.get("path")
    if not path:
        return _bad_request("Missing 'path' (query param or JSON body)")
    r = _get_remote()
    try:
        new_sha = r.delete_file(path, push=True)
    except KeyError as e:
        return _json_response(404, {"error": str(e), "path": path})
    except Exception as e:
        return _json_response(500, {"error": "Delete failed", "detail": str(e)})
    return _json_response(200, {"ref": GIT_REF, "path": path, "commit": new_sha})


def handler(event, context) -> Dict[str, Any]:
    """
    AWS Lambda handler for API Gateway proxy events.

    Routes:
      - OPTIONS *                 -> CORS preflight
      - GET    /health            -> health check
      - GET    /files             -> list files (nested dict)
      - GET    /file?path=...     -> get single file content
      - PUT    /file              -> update/create file content (JSON: {path, content, message?})
      - POST   /file              -> same as PUT (for clients that prefer POST)

    Environment:
      - REMOTE_URI (or GIT_REMOTE_URI)
      - GIT_REF (default: refs/heads/main)
      - GITHUB_TOKEN (or GH_TOKEN or TOKEN)
    """
    try:
        http_method = (event.get("httpMethod") or "").upper()
        path = event.get("path") or "/"

        # CORS preflight
        if http_method == "OPTIONS":
            return _json_response(204, {})

        # Routing
        if http_method == "GET" and path == "/health":
            return _json_response(200, {"status": "ok", "ref": GIT_REF})

        if http_method == "GET" and path == "/files":
            return _handle_get_files()

        if http_method == "GET" and path == "/file":
            return _handle_get_file_content(event)

        if http_method in ("PUT", "POST") and path == "/file":
            return _handle_update_file_content(event)

        # Create & delete routes
        if http_method == "POST" and path == "/file/create":
            return _handle_create_file(event)

        if http_method == "DELETE" and path == "/file":
            return _handle_delete_file(event)

        # Optional: POST /file/delete for clients without DELETE support
        if http_method == "POST" and path == "/file/delete":
            return _handle_delete_file(event)

        return _json_response(
            404, {"error": "Not found", "method": http_method, "path": path}
        )

    except Exception as e:
        # Catch-all to avoid Lambda's 502 if we raise
        return _json_response(
            500,
            {
                "error": "Unhandled exception",
                "detail": str(e),
                "type": type(e).__name__,
            },
        )
