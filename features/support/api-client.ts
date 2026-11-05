/** A tiny HTTP client the steps use to talk to the BFF exactly like a browser or monitor would. */
export interface ApiResponse {
  status: number;
  headers: Headers;
  bodyText: string;
  json: unknown;
}

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  /** Sends a request to the BFF and captures status, headers and body. */
  async request(method: string, path: string, init: RequestInit = {}): Promise<ApiResponse> {
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      method,
      redirect: "manual",
    });
    const bodyText = await response.text();
    let json: unknown = undefined;
    if (response.headers.get("content-type")?.includes("application/json")) {
      json = JSON.parse(bodyText) as unknown;
    }
    return { status: response.status, headers: response.headers, bodyText, json };
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
}
