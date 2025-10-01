import base64
import inspect
import json
import os
import traceback
from typing import Any, Dict, Optional

from remote import Remote
from secret import ACCESS_TOKEN_MAP, AccessTokenInfo
from typedefs import (
    DeleteFileRequest,
    GetFileContentRequest,
    RenameFileRequest,
    UpdateFilesRequest,
)

# CORS settings
CORS_HEADERS = {
    # This should get set automatically by API Gateway anyway
    "Access-Control-Allow-Origin": os.environ.get("CORS_ALLOW_ORIGIN", "*"),
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
}

# Cache across Lambda invocations
_REMOTES: dict[str, Remote] = {}


def _get_remote(token_info: AccessTokenInfo) -> Remote:
    if token_info["token"] not in _REMOTES:
        _REMOTES[token_info["token"]] = Remote(
            token_info["remote_uri"],
            ref=token_info["git_ref"],
            token=token_info["github_token"],
            author_name=token_info["author_name"],
            author_email=token_info["author_email"],
        )

    return _REMOTES[token_info["token"]]


def _json_response(
    status: int, body: Any = {}, extra_headers: Dict[str, str] = {}
) -> Dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            **CORS_HEADERS,
            **extra_headers,
        },
        "body": json.dumps(body),
    }


def _error_response(status: int, message: str):
    return _json_response(status, {"error": message})


def _blob_response(body: bytes):
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/octet-stream", **CORS_HEADERS},
        "body": base64.b64encode(body).decode("utf-8"),
        "isBase64Encoded": True,
    }


def _get_body(event: Dict[str, Any]) -> str:
    body = event.get("body", "")
    # API Gateway might base64-encode the body; note that all blobs will already be base64-encoded by frontend.
    return (
        base64.b64decode(body).decode("utf-8", errors="replace")
        if event.get("isBase64Encoded")
        else body
    )


def _handle_ls(r: Remote) -> Dict[str, Any]:
    return _json_response(200, {"files": r.ls()})


def _handle_get(body: GetFileContentRequest, r: Remote) -> Dict[str, Any]:
    try:
        return _blob_response(r.get(body.path))
    except KeyError:
        return _json_response(404)


def _handle_update(body: UpdateFilesRequest, r: Remote) -> Dict[str, Any]:
    try:
        r.update(body.files, message=body.message)
        return _json_response(200)
    except KeyError:
        # E.g., an intermediate component is not a directory
        return _json_response(400, {"error": traceback.format_exc()})


def _handle_delete(body: DeleteFileRequest, r: Remote) -> Dict[str, Any]:
    try:
        r.delete(body.path)
        return _json_response(200)
    except KeyError as e:
        return _json_response(404, {"error": traceback.format_exc(), "path": body.path})


def _handle_move(body: RenameFileRequest, r: Remote) -> Dict[str, Any]:
    try:
        r.move(
            body.src,
            body.dst,
            message=body.message,
            push=True,
            fail_if_exists=body.fail_if_exists,
        )
        return _json_response(200)
    except KeyError:
        return _json_response(400, {"error": traceback.format_exc()})


ROUTES = {
    "GET /files": _handle_ls,
    "GET /file": _handle_get,
    "POST /file": _handle_update,
    "DELETE /file": _handle_delete,
    "POST /file/rename": _handle_move,
}


def call(function, event, remote):
    payload_type = inspect.signature(function).parameters["body"].annotation
    body = payload_type.model_validate_json(_get_body(event))
    return function(body, remote)


def auth(event):
    auth_header: str = event.get("headers", {}).get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None

    access_token = auth_header[len("Bearer ") :].strip()
    token_info = ACCESS_TOKEN_MAP.get(access_token)
    return _get_remote(token_info) if token_info else None


def handler(event, context) -> Dict[str, Any]:
    http_method = (event.get("httpMethod") or "").upper()
    path = event.get("path") or "/"

    # CORS preflight
    if http_method == "OPTIONS":
        return _json_response(204)

    remote = auth(event)
    if not remote:
        return _error_response(401, "Unauthorized")

    handler_key = f"{http_method} {path}"
    if handler_key not in ROUTES:
        return _error_response(404, "Not Found")

    return call(ROUTES[handler_key], event, remote)
