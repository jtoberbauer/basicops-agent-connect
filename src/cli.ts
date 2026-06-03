#!/usr/bin/env node
/**
 * basicops-connect — connect a BasicOps agent in one command.
 *
 *   basicops-connect --api-key <key> [--agent claude] [--port 3000] [--project <id>]
 *
 * Steps: verify the key → bind the listener → open a Tailscale Funnel →
 * register the agent webhook → create a confirmation task → stay live.
 */
import { BasicOpsClient } from "./basicops.js";
import { startFunnel } from "./funnel.js";
import { startListener } from "./listener.js";

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

const c = {
  step: (s: string) => console.log(`\n\x1b[36m▶ ${s}\x1b[0m`),
  ok: (s: string) => console.log(`  \x1b[32m✓\x1b[0m ${s}`),
  info: (s: string) => console.log(`  ${s}`),
};

function fail(msg: string): never {
  console.error(`\n\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}

function printHelp() {
  console.log(`basicops-connect — connect a BasicOps agent in one command

Usage:
  basicops-connect --api-key <key> [options]

Options:
  --api-key <key>    Agent bearer token (or set BASICOPS_API_KEY)
  --agent <name>     Agent name used to build the MCP URL (default: claude)
  --mcp-url <url>    Override the full MCP endpoint URL
  --port <n>         Local port for the listener (default: 3000)
  --project <id>     Project to create the confirmation task in (optional)
  --webhook-url <u>  Public webhook URL; skips Tailscale Funnel if provided
  --help             Show this help
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  const apiKey = (args["api-key"] as string) ?? process.env.BASICOPS_API_KEY;
  const agent = (args.agent as string) ?? "claude";
  const port = Number(args.port ?? process.env.PORT ?? 3000);
  const mcpUrl =
    (args["mcp-url"] as string) ??
    `https://app.basicops.com/mcp?agent=${encodeURIComponent(agent)}`;
  const projectId = args.project ? Number(args.project) : undefined;
  const explicitWebhook = args["webhook-url"] as string | undefined;

  if (!apiKey) fail("Missing --api-key (or BASICOPS_API_KEY env). See --help.");

  const client = new BasicOpsClient(mcpUrl, apiKey);

  // 1. Verify the key + agent identity.
  c.step("Verifying API key & agent identity");
  const user = await client.call<{ id?: number; firstName?: string }>("get_current_user").catch((e) =>
    fail(`Could not authenticate to ${mcpUrl}\n  ${e.message}`),
  );
  const config = await client.call<{ agentId?: string; enabled?: boolean; ["Display name"]?: string }>(
    "get_agent_configuration",
  );
  if (!user?.id) fail("Authenticated, but no user id returned — is this an agent connector?");
  if (!config?.enabled) fail(`Agent "${config?.agentId ?? agent}" exists but is not enabled in BasicOps.`);
  const agentUserId = String(user.id);
  const displayName = config["Display name"] ?? config.agentId ?? agent;
  c.ok(`Authenticated as agent "${displayName}" (id ${agentUserId}, enabled)`);

  // 2. Bind the listener first (so the Funnel has something to proxy to).
  c.step(`Starting listener on port ${port}`);
  await startListener({ mcpUrl, apiKey, agentUserId, port });
  c.ok("Listener is up");

  // 3. Public URL — Tailscale Funnel (unless one was provided).
  let webhookUrl: string;
  let stopFunnel: (() => Promise<void>) | undefined;
  if (explicitWebhook) {
    webhookUrl = explicitWebhook.replace(/\/$/, "") + "/webhook";
    c.step("Using provided webhook URL");
    c.ok(webhookUrl);
  } else {
    c.step("Opening Tailscale Funnel");
    const funnel = await startFunnel(port).catch((e) => fail(e.message));
    stopFunnel = funnel.stop;
    webhookUrl = `${funnel.url}/webhook`;
    c.ok(`Public URL: ${funnel.url}`);
  }

  // 4. Register the agent webhook.
  c.step("Registering agent webhook");
  const reg = await client.call<{ webhookId?: string }>("connect_agent", {
    kind: "basicops-agent-connect",
    webhook: webhookUrl,
  });
  c.ok(`Webhook registered${reg?.webhookId ? ` (${reg.webhookId})` : ""} → ${webhookUrl}`);

  // 5. Create the confirmation task.
  c.step("Creating confirmation task");
  const task = await client.call<{ id?: number; url?: string }>("create_task", {
    title: `✅ Agent "${displayName}" connected`,
    description:
      `<p>Connected via <strong>basicops-agent-connect</strong> at ${new Date().toISOString()}.</p>` +
      `<p>Webhook: ${webhookUrl}</p>`,
    ...(projectId ? { projectId } : {}),
  });
  c.ok(`Task created${task?.url ? `: ${task.url}` : task?.id ? ` (id ${task.id})` : ""}`);

  // 6. Stay live.
  c.step("Agent is live — send it a message in BasicOps (Ctrl-C to stop)");
  const shutdown = async () => {
    console.log("\nShutting down…");
    if (stopFunnel) await stopFunnel();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => fail(err?.stack ?? String(err)));
