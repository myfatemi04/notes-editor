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
    const url = `${BASE}/file?path=${encodeURIComponent(path)}`;
    return http<FileContentResponse>(url);
  },
  saveFile(req: SaveRequest): Promise<SaveResponse> {
    return http<SaveResponse>(`${BASE}/file`, {
      method: "PUT",
      body: JSON.stringify(req),
    });
  },
};
