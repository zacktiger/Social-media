export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * The access token lives in memory only - never localStorage, so a stray XSS
 * cannot read it back later. The refresh token is an httpOnly cookie the JS
 * here can't touch at all; it is what survives a page reload.
 */
let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

/** Needed by the socket handshake, which cannot send an Authorization header. */
export const getAccessToken = () => accessToken;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
    public fields?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

function request(path: string, init: RequestInit = {}) {
  return fetch(API_URL + path, {
    ...init,
    // Sends the refresh cookie on /api/auth calls.
    credentials: 'include',
    headers: {
      // FormData sets its own content-type with the multipart boundary;
      // overriding it makes the upload unparseable on the server.
      ...(init.body && !(init.body instanceof FormData)
        ? { 'content-type': 'application/json' }
        : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
}

/**
 * Refresh tokens rotate and are single-use, and the API treats a replayed one
 * as theft and kills every session. So concurrent 401s must share ONE refresh
 * call - firing several would log the user out of their own account.
 */
let inFlightRefresh: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  inFlightRefresh ??= (async () => {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      accessToken = null;
      return false;
    }
    const data = await res.json();
    accessToken = data.accessToken;
    return true;
  })().finally(() => {
    inFlightRefresh = null;
  });

  return inFlightRefresh;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await request(path, init);

  // Access tokens last 15 minutes; a single silent retry hides that from the UI.
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    if (await refreshSession()) res = await request(path, init);
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.message ?? `Request failed (${res.status})`,
      body?.error?.code,
      body?.error?.fields,
    );
  }
  return body as T;
}

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });

export const patch = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' });

export function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  return api<T>(path, { method: 'POST', body: form });
}
