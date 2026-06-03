# basicops-agent-connect

Connect a BasicOps agent in one command. Given an agent's API key, the CLI:

1. **Verifies** the key and agent identity (`get_current_user`, `get_agent_configuration`)
2. **Starts** the local webhook listener
3. **Opens** a Tailscale Funnel to get a public HTTPS URL
4. **Registers** the agent webhook (`connect_agent`)
5. **Creates** a confirmation task in BasicOps (proves end-to-end write access)
6. **Stays live**, replying to messages with the Claude Agent SDK

## Prerequisites

- Node ≥ 20
- [Tailscale](https://tailscale.com) installed and logged in (for the Funnel), or bring your own `--webhook-url`
- An agent created in BasicOps, and its **API key** (bearer token)
- Claude Agent SDK auth (Claude subscription via the `claude` CLI, or `ANTHROPIC_API_KEY`)

## Install

```bash
npm install
npm run build
npm link        # makes `basicops-connect` available globally
```

Or run without building: `npm run dev -- --api-key <key>`

## Usage

```bash
basicops-connect --api-key <key> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--api-key <key>` | Agent bearer token (or `BASICOPS_API_KEY` env) | — |
| `--agent <name>` | Agent name used to build the MCP URL | `claude` |
| `--mcp-url <url>` | Override the full MCP endpoint URL | `https://app.basicops.com/mcp?agent=<name>` |
| `--port <n>` | Local listener port | `3000` |
| `--project <id>` | Project to create the confirmation task in | (none) |
| `--webhook-url <u>` | Public URL; skips Tailscale Funnel | (uses Funnel) |
| `--help` | Show help | — |

### Example

```bash
basicops-connect --api-key bo_xxx --agent claude
```

The API key can also be passed via env to keep it out of shell history:

```bash
BASICOPS_API_KEY=bo_xxx basicops-connect
```

## How it works

- [src/basicops.ts](src/basicops.ts) — a tiny stateless MCP JSON-RPC client used
  for the deterministic provisioning calls.
- [src/funnel.ts](src/funnel.ts) — wraps `tailscale funnel` to expose the port
  and derive the public MagicDNS URL.
- [src/listener.ts](src/listener.ts) — the webhook server; generates replies with
  the Claude Agent SDK (per-chat memory, loop guard, destructive tools blocked).
- [src/cli.ts](src/cli.ts) — argument parsing and the connect sequence.

## Security notes

- Prefer `BASICOPS_API_KEY` over `--api-key` so the token isn't visible in `ps` / shell history.
- The agent is granted the whole BasicOps tool server **except** destructive tools
  (`delete_*`, `deactivate_user`, `reactivate_user`), which are blocked.
