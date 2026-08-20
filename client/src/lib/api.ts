const TOKEN_KEY = "seal_access";

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

let refreshing: Promise<string | null> | null = null;

async function refreshAccess() {
  if (!refreshing) {
    refreshing = fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
      .then(async (r) => {
        if (!r.ok) return null;
        const data = await r.json();
        setToken(data.accessToken);
        return data.accessToken as string;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function downloadFile(path: string, fallbackName: string) {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let res = await fetch(path, { headers, credentials: "include" });
  if (res.status === 401) {
    const next = await refreshAccess();
    if (next) {
      headers.set("Authorization", `Bearer ${next}`);
      res = await fetch(path, { headers, credentials: "include" });
    }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "");
  const name = match?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let res = await fetch(path, { ...init, headers, credentials: "include" });
  if (res.status === 401 && !path.includes("/api/auth/login")) {
    const next = await refreshAccess();
    if (next) {
      headers.set("Authorization", `Bearer ${next}`);
      res = await fetch(path, { ...init, headers, credentials: "include" });
    }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || res.statusText) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = body.code;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
