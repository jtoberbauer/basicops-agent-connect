/**
 * Webhook listener: receives BasicOps `connect_agent` events, generates a reply
 * with the Claude Agent SDK (which can read/write BasicOps via its MCP tools),
 * and posts it back — with per-chat memory and a loop guard.
 */
import http from "node:http";
import { query } from "@anthropic-ai/claude-agent-sdk";

export type ListenerConfig = {
  mcpUrl: string;
  apiKey: string;
  agentUserId: string; // skip the agent's own messages (loop guard)
  port: number;
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
  chatId?: number;
  userId?: number;
  messageId?: string;
  text: string;
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

// connect_agent enriched shape: { event, context: { userId, chatId, messageId }, request }
// (also tolerates the create_webhook batch shape: { events: [{ event, data }] })
function parseEvents(body: any, agentUserId: string): Incoming[] {
  const list = Array.isArray(body?.events) ? body.events : [body];
  return list.map((e: any): Incoming => {
    const ctx = e?.context ?? e?.data ?? {};
    const message = e?.request ?? e?.data?.message ?? e?.message ?? "";
    return {
      event: String(e?.event ?? ctx?.event ?? ""),
      chatId: ctx.chatId,
      userId: ctx.userId,
      messageId: ctx.messageId ?? ctx.id,
      text: htmlToText(message),
      fromAgent: String(ctx.userId) === agentUserId,
    };
  });
}

export function startListener(cfg: ListenerConfig): Promise<void> {
  const sessions = new Map<number, string>(); // chatId -> Agent SDK session id

  async function handleMessage(chatId: number, text: string, messageId?: string) {
    const resume = sessions.get(chatId);
    const statusLine = messageId
      ? `The triggering message id is "${messageId}".\n\nDo this in order:\n` +
        `1. Reply helpfully and concisely by calling create_message_in_chat with chatId ${chatId}.\n` +
        `2. Then call set_agent_status with event "${messageId}", id "${messageId}", status "done".`
      : `Reply helpfully and concisely by calling create_message_in_chat with chatId ${chatId}.`;

    const response = query({
      prompt: `A user sent this message in BasicOps chat ${chatId}:\n\n"${text}"\n\n${statusLine}`,
      options: {
        resume,
        mcpServers: {
          basicops: {
            type: "http",
            url: cfg.mcpUrl,
            headers: { Authorization: `Bearer ${cfg.apiKey}` },
          },
        },
        allowedTools: ["mcp__basicops"],
        disallowedTools: BLOCKED_TOOLS,
        systemPrompt:
          "You are a helpful assistant replying to messages in BasicOps. Be concise " +
          "and friendly. Always post your reply with create_message_in_chat using the " +
          "chatId you were given, then clear your status with set_agent_status status='done'.",
        maxTurns: 10,
      },
    });

    for await (const m of response) {
      if (m.type === "assistant") {
        for (const b of m.message.content as any[]) {
          if (b.type === "tool_use") console.log(`  [tool] ${b.name}`);
        }
      } else if (m.type === "result") {
        sessions.set(chatId, m.session_id);
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
        if (ev.event && !ev.event.includes("message.created")) continue;
        if (ev.fromAgent) continue; // loop guard
        if (!ev.chatId || !ev.text) continue;
        console.log(`[chat ${ev.chatId}] ${ev.text}`);
        try {
          await handleMessage(Number(ev.chatId), ev.text, ev.messageId);
        } catch (err) {
          console.error("  handler error:", err);
        }
      }
    });
  });

  return new Promise<void>((resolve) =>
    server.listen(cfg.port, () => {
      console.log(`Listener bound on http://localhost:${cfg.port}/webhook`);
      resolve();
    }),
  );
}
