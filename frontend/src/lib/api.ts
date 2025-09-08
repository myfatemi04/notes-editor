import {
  FilesResponse,
  FileContentResponse,
  SaveRequest,
  SaveResponse,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE_URL as string;

async function http<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    let detail: any = undefined;
    try {
      detail = await res.json();
    } catch {}
    throw new Error(
      detail?.error || detail?.message || `${res.status} ${res.statusText}`
    );
  }
  return res.json() as Promise<T>;
}

export const api = {
  listFiles(): Promise<FilesResponse> {
    return http<FilesResponse>(`${BASE}/files`);
  },
  getFile(path: string): Promise<FileContentResponse> {
    return http<FileContentResponse>(
      `${BASE}/file?path=${encodeURIComponent(path)}`
    );
  },
  saveFile(req: SaveRequest): Promise<SaveResponse> {
    return http<SaveResponse>(`${BASE}/file`, {
      method: "PUT",
      body: JSON.stringify(req),
    });
  },
  createFile(req: CreateRequest): Promise<SaveResponse> {
    return http<SaveResponse>(`${BASE}/file/create`, {
      method: "POST",
      body: JSON.stringify(req),
    });
  },
  renameFile(req: RenameRequest): Promise<SaveResponse> {
    return http<SaveResponse>(`${BASE}/file/rename`, {
      method: "POST",
      body: JSON.stringify(req),
    });
  },
  deleteFile(path: string): Promise<DeleteResponse> {
    const url = `${BASE}/file?path=${encodeURIComponent(path)}`;
    return http<DeleteResponse>(url, { method: "DELETE" });
  },
};
