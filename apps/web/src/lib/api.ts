const BASE = '/api/v1';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('token') : null;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  get:    <T>(p: string)             => request<T>(p),
  post:   <T>(p: string, b: unknown) => request<T>(p, { method: 'POST',  body: JSON.stringify(b) }),
  patch:  <T>(p: string, b: unknown) => request<T>(p, { method: 'PATCH', body: JSON.stringify(b) }),
  delete: <T>(p: string)             => request<T>(p, { method: 'DELETE' }),
};
