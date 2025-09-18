import json
import os
import traceback
from typing import Any, Dict, Optional

from remote import Remote
from secret import ACCESS_TOKEN_MAP, AccessTokenInfo


# CORS settings
CORS_HEADERS = {
    # This should get set automatically by API Gateway anyway
    "Access-Control-Allow-Origin": os.environ.get("CORS_ALLOW_ORIGIN", "*"),
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}

# Cache the Remote instance across Lambda invocations
_REMOTE_SINGLETONS: dict[str, Remote] = {}


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


def _get_remote(token_info: AccessTokenInfo) -> Remote:
    """
    Returns a cached Remote instance, constructing it if needed. Keys for Remotes are given by access tokens. Therefore, access tokens must be unique to each ghp/remote combination.
    Uses a GitHub token resolved from env/Secrets Manager/SSM.
    """

    if not token_info["remote_uri"]:
        raise RuntimeError("REMOTE_URI token variable is not set")

    if token_info["token"] not in _REMOTE_SINGLETONS:
        _REMOTE_SINGLETONS[token_info["token"]] = Remote(
            token_info["remote_uri"],
            ref=token_info["git_ref"],
            token=token_info["github_token"],
            author_name=token_info["author_name"],
            author_email=token_info["author_email"],
        )

    return _REMOTE_SINGLETONS[token_info["token"]]


def _handle_get_files(token_info: AccessTokenInfo) -> Dict[str, Any]:
    r = _get_remote(token_info)
    files = r.get_files()
    return _json_response(200, {"ref": token_info["git_ref"], "files": files})


def _handle_get_file_content(
    event: Dict[str, Any], token_info: AccessTokenInfo
) -> Dict[str, Any]:
    qs = event.get("queryStringParameters") or {}
    path = qs.get("path")
    if not path:
        return _bad_request("Missing required query parameter: path")

    r = _get_remote(token_info)
    try:
        content = r.get_file_content(path)
    except KeyError as e:
        return _json_response(404, {"error": traceback.format_exc(), "path": path})
    return _json_response(
        200, {"ref": token_info["git_ref"], "path": path, "content": content}
    )


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


def _handle_update_file_content(
    event: Dict[str, Any], token_info: AccessTokenInfo
) -> Dict[str, Any]:
    data = _parse_json_body(event)
    path = data.get("path")
    new_content = data.get("content")
    message = data.get("message")

    if not path or new_content is None:
        return _bad_request("JSON body must include 'path' and 'content'")

    r = _get_remote(token_info)
    try:
        new_sha = r.update_file_content(
            path,
            new_content,
            message=message,
            push=True,
            fail_if_exists=False,
            fail_if_not_exists=True,
        )
    except KeyError as e:
        # E.g., an intermediate component is not a directory
        return _json_response(400, {"error": traceback.format_exc(), "path": path})
    except Exception as e:
        # Generic failure (auth, push rejected, etc.)
        traceback.print_exc()
        return _json_response(
            500, {"error": "Update failed", "detail": traceback.format_exc()}
        )

    return _json_response(
        200, {"ref": token_info["git_ref"], "path": path, "commit": new_sha}
    )


def _handle_create_file(
    event: Dict[str, Any], token_info: AccessTokenInfo
) -> Dict[str, Any]:
    data = _parse_json_body(event)
    path = data.get("path")
    content = data.get("content", "")
    message = data.get("message")
    fail_if_exists = bool(data.get("fail_if_exists", True))
    if not path:
        return _bad_request("JSON body must include 'path'")
    r = _get_remote(token_info)
    try:
        new_sha = r.update_file_content(
            path,
            content,
            message=message,
            push=True,
            fail_if_exists=fail_if_exists,
            fail_if_not_exists=False,
        )
    except KeyError as e:
        return _json_response(409, {"error": traceback.format_exc(), "path": path})
    except Exception as e:
        traceback.print_exc()
        return _json_response(
            500, {"error": "Create failed", "detail": traceback.format_exc()}
        )
    return _json_response(
        200, {"ref": token_info["git_ref"], "path": path, "commit": new_sha}
    )


def _handle_delete_file(
    event: Dict[str, Any], token_info: AccessTokenInfo
) -> Dict[str, Any]:
    qs = event.get("queryStringParameters") or {}
    path = qs.get("path")
    if not path:
        # Also support JSON body for DELETE if client can't send query params
        data = _parse_json_body(event)
        path = data.get("path")
    if not path:
        return _bad_request("Missing 'path' (query param or JSON body)")
    r = _get_remote(token_info)
    try:
        new_sha = r.delete_file(path, push=True)
    except KeyError as e:
        return _json_response(404, {"error": traceback.format_exc(), "path": path})
    except Exception as e:
        traceback.print_exc()
        return _json_response(
            500, {"error": "Delete failed", "detail": traceback.format_exc()}
        )
    return _json_response(
        200, {"ref": token_info["git_ref"], "path": path, "commit": new_sha}
    )


def _handle_rename_file(
    event: Dict[str, Any], token_info: AccessTokenInfo
) -> Dict[str, Any]:
    data = _parse_json_body(event)
    src = data.get("src") or data.get("source") or data.get("from")
    dst = data.get("dst") or data.get("destination") or data.get("to")
    message = data.get("message")
    fail_if_exists = bool(data.get("fail_if_exists", True))

    if not src or not dst:
        return _bad_request("JSON body must include 'src' and 'dst'")

    r = _get_remote(token_info)
    try:
        new_sha = r.rename_file(
            src, dst, message=message, push=True, fail_if_exists=fail_if_exists
        )
    except KeyError as e:
        return _json_response(
            400, {"error": traceback.format_exc(), "src": src, "dst": dst}
        )
    except Exception as e:
        traceback.print_exc()
        return _json_response(
            500, {"error": "Rename failed", "detail": traceback.format_exc()}
        )

    return _json_response(
        200, {"ref": token_info["git_ref"], "src": src, "dst": dst, "commit": new_sha}
    )


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

        auth_header = event.get("headers", {}).get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return _json_response(401, {"error": "Unauthorized"})

        access_token = auth_header[len("Bearer ") :].strip()
        token_info = ACCESS_TOKEN_MAP.get(access_token)
        if not token_info:
            return _json_response(403, {"error": "Forbidden"})

        # Routing
        if http_method == "GET" and path == "/health":
            return _json_response(200, {"status": "ok", "ref": token_info["git_ref"]})

        if http_method == "GET" and path == "/files":
            return _handle_get_files(token_info)

        if http_method == "GET" and path == "/file":
            return _handle_get_file_content(event, token_info)

        if http_method in ("PUT", "POST") and path == "/file":
            return _handle_update_file_content(event, token_info)

        # Create & delete routes
        if http_method == "POST" and path == "/file/create":
            return _handle_create_file(event, token_info)

        if http_method == "DELETE" and path == "/file":
            return _handle_delete_file(event, token_info)

        # Optional: POST /file/delete for clients without DELETE support
        if http_method == "POST" and path == "/file/delete":
            return _handle_delete_file(event, token_info)

        # Rename route
        if http_method == "POST" and path == "/file/rename":
            return _handle_rename_file(event, token_info)

        return _json_response(
            404, {"error": "Not found", "method": http_method, "path": path}
        )

    except Exception as e:
        # Catch-all to avoid Lambda's 502 if we raise
        traceback.print_exc()
        return _json_response(
            500,
            {
                "error": "Unhandled exception",
                "detail": traceback.format_exc(),
                "type": type(e).__name__,
            },
        )
