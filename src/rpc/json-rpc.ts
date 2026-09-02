export interface JsonRpcTransportOptions {
  url: string;
  username?: string | undefined;
  password?: string | undefined;
  headers?: Record<string, string> | undefined;
  timeoutMs?: number | undefined;
  fetch?: typeof globalThis.fetch | undefined;
}

interface JsonRpcSuccess<T> {
  jsonrpc?: string;
  id: number;
  result: T;
  error?: null;
}

interface JsonRpcFailure {
  jsonrpc?: string;
  id: number;
  result?: null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "JsonRpcError";
  }
}

export class JsonRpcClient {
  private nextId = 1;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: JsonRpcTransportOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!this.fetchImpl) {
      throw new Error("A Fetch implementation is required");
    }
    const url = new URL(options.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("JSON-RPC URL must use HTTP or HTTPS");
    }
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const id = this.nextId++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers(this.options.headers);
    headers.set("content-type", "application/json");

    if (
      this.options.username !== undefined ||
      this.options.password !== undefined
    ) {
      const credentials = `${this.options.username ?? ""}:${this.options.password ?? ""}`;
      headers.set(
        "authorization",
        `Basic ${Buffer.from(credentials).toString("base64")}`,
      );
    }

    try {
      const response = await this.fetchImpl(this.options.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `JSON-RPC HTTP request failed with status ${response.status}`,
        );
      }

      const body = (await response.json()) as
        JsonRpcSuccess<T> | JsonRpcFailure;
      if (body.id !== id) {
        throw new Error("JSON-RPC response ID did not match the request");
      }
      if ("error" in body && body.error) {
        throw new JsonRpcError(
          body.error.code,
          body.error.message,
          body.error.data,
        );
      }
      if (!("result" in body)) {
        throw new Error("JSON-RPC response did not contain a result");
      }
      return body.result as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function isTransactionNotFound(error: unknown): boolean {
  if (!(error instanceof JsonRpcError)) {
    return false;
  }
  return (
    error.code === -5 ||
    /not found|no such mempool|invalid or non-wallet/i.test(error.message)
  );
}
