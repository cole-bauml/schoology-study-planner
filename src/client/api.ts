interface ApiErrorBody {
  error?: string;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers
    }
  });
  const result: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const body = result as ApiErrorBody;
    throw new Error(body.error ?? `Request failed (${response.status}).`);
  }
  return result as T;
}
