import type { ApiError } from "@softlans/contracts";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    throw new HttpError(
      0,
      "Serverga ulanib bo‘lmadi. Internet aloqasini tekshirib, qayta urinib ko‘ring.",
    );
  }
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as ApiError | null;
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    throw new HttpError(
      response.status,
      payload?.error?.message ?? "So‘rov bajarilmadi. Qayta urinib ko‘ring.",
      payload?.error?.fields,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
