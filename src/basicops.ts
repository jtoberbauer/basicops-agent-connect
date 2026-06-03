/**
 * Minimal BasicOps MCP client.
 *
 * The BasicOps MCP endpoint (e.g. https://app.basicops.com/mcp?agent=claude)
 * speaks JSON-RPC over Streamable HTTP and accepts stateless `tools/call`
 * requests authenticated with a bearer token. We use it directly (rather than
 * through an LLM) for the deterministic provisioning steps.
 */
export class BasicOpsClient {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
  ) {}

  /** Call a BasicOps MCP tool and return its parsed JSON result. */
  async call<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });

    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`BasicOps "${name}" failed: HTTP ${res.status} ${raw.slice(0, 300)}`);
    }

    const json = extractJsonRpc(raw);
    if (json?.error) {
      throw new Error(`BasicOps "${name}" error: ${JSON.stringify(json.error)}`);
    }

    // Tool results arrive as { result: { content: [{ type: "text", text: "<json>" }] } }
    const textContent = json?.result?.content?.[0]?.text;
    if (typeof textContent === "string") {
      try {
        return JSON.parse(textContent) as T;
      } catch {
        return textContent as unknown as T;
      }
    }
    return json?.result as T;
  }
}

/** Streamable HTTP may return plain JSON or SSE framing; handle both. */
function extractJsonRpc(raw: string): any {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);

  // SSE: one or more "data: { ... }" lines; take the last parseable one.
  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter(Boolean)
    .reverse();

  for (const d of dataLines) {
    try {
      return JSON.parse(d);
    } catch {
      /* keep trying */
    }
  }
  throw new Error(`Unparseable MCP response: ${raw.slice(0, 200)}`);
}
