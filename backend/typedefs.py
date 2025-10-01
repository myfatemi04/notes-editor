import pydantic
from typing import Optional


class FileUpdate(pydantic.BaseModel):
    path: str
    content: str
    b64: bool
    fail_if_exists = False
    fail_if_not_exists = False


class UpdateFilesRequest(pydantic.BaseModel):
    files: list[FileUpdate]
    message: Optional[str] = None


class GetFileContentRequest(pydantic.BaseModel):
    path: str


class DeleteFileRequest(pydantic.BaseModel):
    path: str


class RenameFileRequest(pydantic.BaseModel):
    src: str
    dst: str
    message: Optional[str] = None
    fail_if_exists: bool = True
