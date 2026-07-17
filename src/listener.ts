/**
 * Webhook listener: receives BasicOps events and hands each raw payload to the
 * Claude Agent SDK, which runs the bundled `basicops-webhook` skill to decide how
 * to respond (which surface, which tool, or stay silent) and posts back via the
 * BasicOps MCP tools. Thin transport — the skill owns the behavior. Per-
 * conversation session memory + a loop guard for the agent's own messages.
 */
import http from "node:http";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentCapabilities } from "./config.js";

export type ListenerConfig = {
  mcpUrl: string;
  apiKey: string;
  agentUserId: string; // skip the agent's own messages (loop guard)
  port: number;
  /** Optional extra MCP connectors + skill plugins from the per-agent config file. */
  capabilities?: AgentCapabilities;
};

// Destructive tools the agent must never call (blocked even though the whole
// BasicOps server is otherwise allowed). disallowedTools takes precedence.
const BLOCKED_TOOLS = [
  "delete_task", "delete_project", "delete_note", "delete_section",
  "delete_channel", "delete_groupchat", "delete_message", "delete_reply",
  "delete_template", "delete_time_entry", "delete_task_dependency", "delete_webhook",
  "deactivate_user", "reactivate_user",
].map((t) => `mcp__basicops__${t}`);

type Incoming = {
  event: string;
  context: Record<string, any>; // full context: all surface/entity IDs
  request: string; // raw HTML of the user's message (as the skill expects)
  userId?: number;
  convId: string; // for per-conversation session memory
  fromAgent: boolean;
};

const htmlToText = (s: unknown): string =>
  String(s ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

// Webhook shape: { event, context: { userId, taskId/chatId/…, messageId, replyId }, request }
// (also tolerates the batch shape: { events: [{ event, data: { context, request } }] }).
// We hand the whole { context, request } to the agent and let the skill drive.
function parseEvents(body: any, agentUserId: string): Incoming[] {
  const list = Array.isArray(body?.events) ? body.events : [body];
  return list.map((e: any): Incoming => {
    const context = e?.context ?? e?.data?.context ?? e?.data ?? {};
    const request = e?.request ?? e?.data?.request ?? e?.data?.message ?? e?.message ?? "";
    const convId = String(
      context.taskId ?? context.chatId ?? context.groupChatId ?? context.channelId ?? context.projectId ?? "default",
    );
    return {
      event: String(e?.event ?? context?.event ?? ""),
      context,
      request: typeof request === "string" ? request : JSON.stringify(request),
      userId: context.userId,
      convId,
      fromAgent: String(context.userId) === agentUserId,
    };
  });
}

export function startListener(cfg: ListenerConfig): Promise<number> {
  const sessions = new Map<string, string>(); // convId -> Agent SDK session id

  const caps = cfg.capabilities ?? { mcpServers: {}, plugins: [], allowedTools: [] };

  // The built-in BasicOps connector, plus any extra ones from config.
  const mcpServers = {
    basicops: {
      type: "http" as const,
      url: cfg.mcpUrl,
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    },
    ...caps.mcpServers,
  };

  // Allowlist: BasicOps + web research (so the agent can look up REAL MCP setup
  // instructions instead of guessing) + one entry per extra MCP server + `Skill`
  // when plugins load + any explicit extras. disallowedTools still blocks
  // destructive ops; the agent has no filesystem/shell access.
  const allowedTools = [
    "mcp__basicops",
    "WebSearch",
    "WebFetch",
    ...Object.keys(caps.mcpServers).map((name) => `mcp__${name}`),
    ...(caps.plugins.length ? ["Skill"] : []),
    ...caps.allowedTools,
  ];

  let loggedCapabilities = false;

  // Hand the raw webhook payload to the agent and let the basicops-webhook skill
  // decide everything (which surface, which tool, whether to stay silent). The
  // listener is deliberately a thin transport — no hardcoded reply mechanics.
  async function handleEvent(ev: Incoming) {
    const resume = sessions.get(ev.convId);
    const payload = JSON.stringify({ context: ev.context, request: ev.request });

    const response = query({
      prompt:
        "You received a BasicOps webhook event. Handle it by following your " +
        "basicops-webhook skill exactly. Event payload:\n\n" +
        payload,
      options: {
        resume,
        mcpServers,
        plugins: caps.plugins,
        allowedTools,
        disallowedTools: BLOCKED_TOOLS,
        systemPrompt:
          "You are a BasicOps agent connected via webhook. For every incoming event, follow " +
          "your basicops-webhook skill exactly: read the payload (context + request), decide " +
          "whether to respond, fetch only the context you need, and deliver your reply by " +
          "calling the correct BasicOps posting tool (create_reply_in_message when context has " +
          "a messageId). Never finish without posting via a tool when a reply is warranted. " +
          "If the user asks how to extend, configure, or connect you to other tools/services, " +
          "use the add-capability skill.",
        maxTurns: 14,
        stderr: (d: string) => {
          const line = d.trim();
          if (line) console.error(`  [claude stderr] ${line}`);
        },
      },
    });

    for await (const m of response) {
      if (m.type === "system" && (m as any).subtype === "init" && !loggedCapabilities) {
        loggedCapabilities = true;
        const sys = m as any;
        const skills = (sys.skills ?? []).filter((s: string) => s !== "none");
        const servers = (sys.mcp_servers ?? []).map((s: any) => `${s.name}(${s.status})`);
        if (servers.length) console.log(`  [mcp] ${servers.join(", ")}`);
        if (skills.length) console.log(`  [skills] ${skills.join(", ")}`);
      } else if (m.type === "assistant") {
        for (const b of m.message.content as any[]) {
          if (b.type === "tool_use") console.log(`  [tool] ${b.name}`);
        }
      } else if (m.type === "result") {
        sessions.set(ev.convId, m.session_id);
        console.log(`  done (${m.num_turns} turns)`);
      }
    }
  }

  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/webhook")) {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');

      let body: unknown;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return;
      }

      for (const ev of parseEvents(body, cfg.agentUserId)) {
        if (ev.fromAgent) continue; // loop guard: skip the agent's own messages
        if (!ev.request) continue; // nothing to respond to (lifecycle/empty events)
        console.log(`[${ev.event || "event"}] conv ${ev.convId}: ${htmlToText(ev.request).slice(0, 100)}`);
        try {
          await handleEvent(ev);
        } catch (err) {
          console.error("  handler error:", err);
        }
      }
    });
  });

  // cfg.port may be 0 (auto-pick a free port); resolve with the actual port.
  return new Promise<number>((resolve) =>
    server.listen(cfg.port, () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : cfg.port;
      console.log(`Listener bound on http://localhost:${actual}/webhook`);
      resolve(actual);
    }),
  );
}
