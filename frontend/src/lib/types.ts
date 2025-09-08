export type FileTree = { [name: string]: null | FileTree };

export interface FilesResponse {
  ref: string;
  files: FileTree;
}

export interface FileContentResponse {
  ref: string;
  path: string;
  content: string;
}

export interface SaveRequest {
  path: string;
  content: string;
  message?: string;
}

export interface SaveResponse {
  ref: string;
  path: string;
  commit: string;
}
