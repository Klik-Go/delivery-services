/** A tiny HTTP client the steps use to talk to the BFF exactly like a browser or monitor would. */
export interface ApiResponse {
  status: number;
  headers: Headers;
  bodyText: string;
  json: unknown;
}

/**
 * Keeps cookies between requests (like a browser) so auth steps can sign in through the BFF and
 * then call protected routes. Each scenario gets its own client, so sessions never leak.
 */
export class ApiClient {
  readonly cookies = new Map<string, string>();
  /** Extra headers for every request, e.g. X-Forwarded-For to give a scenario its own network. */
  readonly headers = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  /** Sends a request to the BFF and captures status, headers and body; stores Set-Cookie. */
  async request(
    method: string,
    path: string,
    init: RequestInit & { json?: unknown } = {},
  ): Promise<ApiResponse> {
    const headers = new Headers(init.headers);
    for (const [name, value] of this.headers) headers.set(name, value);
    if (this.cookies.size > 0) {
      headers.set(
        "cookie",
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    }
    const { json: payload, ...rest } = init;
    let body: BodyInit | null = rest.body ?? null;
    if (payload !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(payload);
    }
    const response = await fetch(new URL(path, this.baseUrl), {
      ...rest,
      method,
      headers,
      body,
      redirect: "manual",
    });
    this.storeCookies(response.headers);
    const bodyText = await response.text();
    let json: unknown = undefined;
    if (response.headers.get("content-type")?.includes("application/json")) {
      json = JSON.parse(bodyText) as unknown;
    }
    return { status: response.status, headers: response.headers, bodyText, json };
  }

  /** POST with a JSON body. */
  async post(path: string, json: unknown): Promise<ApiResponse> {
    return this.request("POST", path, { json });
  }

  /** True when GET /api/health answers, so scenarios fail fast with a clear message otherwise. */
  async isUp(): Promise<boolean> {
    try {
      const response = await this.request("GET", "/api/health");
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /** A copy of this client with the same cookies (e.g. to replay an old session). */
  clone(): ApiClient {
    const copy = new ApiClient(this.baseUrl);
    for (const [name, value] of this.cookies) copy.cookies.set(name, value);
    for (const [name, value] of this.headers) copy.headers.set(name, value);
    return copy;
  }

  private storeCookies(headers: Headers): void {
    for (const line of headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}
