export type PageMeta = { page: number; pageSize: number; total: number; totalPages: number };

export class ApiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(message: string, code = 'ERROR', status = 500, details: unknown = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type Session = {
  accessToken: string;
  user: AuthUser;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  mustChangePassword: boolean;
  role: { id: string; name: string };
  permissions: Record<string, string[]>;
};

let accessToken: string | null = null;
let refreshPromise: Promise<Session | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

async function parse(res: Response) {
  const text = await res.text();
  if (!text) return { data: null, error: null, meta: null };
  return JSON.parse(text) as { data: unknown; error: { code: string; message: string; details: unknown } | null; meta: PageMeta | null };
}

export async function refreshSession(): Promise<Session | null> {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(async (res) => {
        if (!res.ok) {
          accessToken = null;
          return null;
        }
        const body = await parse(res);
        const data = body.data as Session;
        accessToken = data.accessToken;
        return data;
      })
      .catch(() => {
        accessToken = null;
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; skipRefresh?: boolean } = {},
): Promise<{ data: T; meta: PageMeta | null }> {
  const res = await fetch(`/api/v1${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (res.status === 401 && !options.skipRefresh && !path.startsWith('/auth/login') && path !== '/auth/refresh') {
    const session = await refreshSession();
    if (session) return api<T>(path, { ...options, skipRefresh: true });
  }
  const body = await parse(res);
  if (!res.ok) {
    throw new ApiError(body.error?.message ?? 'Request failed', body.error?.code ?? 'ERROR', res.status, body.error?.details);
  }
  return { data: body.data as T, meta: body.meta };
}

export async function downloadCsv(path: string, filename: string) {
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) {
    const body = await parse(res);
    throw new ApiError(body.error?.message ?? 'Export failed', body.error?.code ?? 'ERROR', res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function can(user: AuthUser | null, module: string, action: string) {
  return Boolean(user?.permissions?.[module]?.includes(action));
}
