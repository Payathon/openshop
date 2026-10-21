// The workbench talks to the server on the same origin. The merchant's session is an
// HttpOnly cookie set at login, so no token is handled here.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined || body instanceof Blob ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: body instanceof Blob ? body : JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, "unreachable", "连不上服务器，请检查网络后重试");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(res.status, "bad_response", `服务器返回了意外的内容（HTTP ${res.status}）`);
  }
  if (!res.ok) {
    const e = data as { error?: string; message?: string } | null;
    throw new ApiError(res.status, e?.error ?? "http_error", e?.message ?? `请求失败（HTTP ${res.status}）`);
  }
  return data as T;
}

export const get = <T,>(path: string) => request<T>("GET", path);
export const post = <T,>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
export const put = <T,>(path: string, body: unknown) => request<T>("PUT", path, body);
export const del = <T,>(path: string) => request<T>("DELETE", path);

export const isUnauthorized = (err: unknown) => err instanceof ApiError && err.status === 401;
export const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
