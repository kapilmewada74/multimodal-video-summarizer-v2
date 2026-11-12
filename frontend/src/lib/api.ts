/**
 * fetch() for our own API: adds the signed-in user's token to every request and
 * retries once with a fresh token if the server says the session expired.
 */
export type TokenProvider = {
  getToken: () => Promise<string | null>;
  refreshToken?: () => Promise<string | null>;
};

let provider: TokenProvider = { getToken: async () => null };

export function setTokenProvider(next: TokenProvider): void {
  provider = next;
}

/** The current sign-in token (for requests that cannot use fetch, such as uploads with progress). */
export async function getAuthToken(): Promise<string | null> {
  return provider.getToken();
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const send = async (token: string | null) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  const token = await provider.getToken();
  const response = await send(token);
  if (response.status === 401 && provider.refreshToken) {
    const fresh = await provider.refreshToken();
    if (fresh && fresh !== token) return send(fresh);
  }
  return response;
}

/** A readable message from an error response ({message}, {detail}, or text). */
export async function readError(response: Response, fallback = "Something went wrong. Please try again."): Promise<string> {
  try {
    const data = await response.clone().json();
    if (typeof data?.message === "string" && data.message) return data.message;
    if (typeof data?.detail === "string" && data.detail) return data.detail;
    if (Array.isArray(data?.detail) && data.detail[0]?.msg) return "Some of the information sent was invalid.";
  } catch {
    // not JSON: fall through
  }
  return fallback;
}
