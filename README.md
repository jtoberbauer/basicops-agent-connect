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

**On a server (recommended)** — one command does everything (installs deps,
connects Tailscale, launches the installer, handles the Claude login, offers a
persistent service). See [DEPLOY.md](DEPLOY.md):

```bash
gh repo clone jtoberbauer/basicops-agent-connect
cd basicops-agent-connect
bash scripts/setup-vps.sh
```

**Local / manual:**

```bash
npm install
npm run build
npm link        # makes `basicops-connect` available globally
```

## Usage

```bash
basicops-connect --api-key <key> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--api-key <key>` | Agent bearer token (or `BASICOPS_API_KEY` env) | — |
| `--mcp-url <url>` | Override the full MCP endpoint URL | `https://app.basicops.com/mcp?agent=<name>` |
| `--port <n>` | Local listener port | auto (free port) |
| `--funnel-path <p>` | Path on the shared :443 Funnel | `/<agent>` |
| `--project <id>` | Project to create the confirmation task in | (none) |
| `--webhook-url <u>` | Public URL; skips Tailscale Funnel | (uses Funnel) |
| `--help` | Show help | — |

### Example

```bash
basicops-connect --api-key bo_xxx --agent claude
```

## Running multiple agents concurrently

Each agent mounts its own path on the shared :443 Tailscale Funnel and auto-picks
a free local port, so you can run many at once on one machine — including
alongside the OpenAI build (`basicops-connect-openai`). Just give each its own
agent identity:

```bash
basicops-connect        --api-key bo_aaa --agent claude       # → https://<host>/claude/webhook
basicops-connect-openai --api-key bo_bbb --agent support-bot  # → https://<host>/support-bot/webhook
```

Each registers its own webhook and is isolated (separate process, port, path,
sessions). Stopping one removes only its Funnel mount. If you previously ran an
agent on the root Funnel path, run `tailscale funnel reset` once before starting
the path-based agents.

The API key can also be passed via env to keep it out of shell history:

```bash
BASICOPS_API_KEY=bo_xxx basicops-connect
```

## Adding skills & MCP connectors

Give an agent extra abilities **without editing code** by dropping a JSON file at
`~/.config/basicops-agent/<agent-slug>.json` (same slug as its `.env`, e.g.
`claude-agent.json`) and restarting. Missing file → the agent runs exactly as
before. See [config.example.json](config.example.json):

```jsonc
{
  "mcpServers": {
    "github": { "type": "http", "url": "https://…/mcp", "authToken": "…" }
  },
  "plugins": ["/home/gus/basicops-agent-connect/plugins/basicops-extras"],
  "allowedTools": []
}
```

- **`mcpServers`** — extra MCP connectors alongside the built-in `basicops`.
  `authToken` becomes an `Authorization: Bearer` header. Each server is
  auto-added to the tool allowlist as `mcp__<name>`. (`stdio` servers via
  `command`/`args` also work if the binary is on the box.)
- **`plugins`** — local [Claude Code plugin](https://docs.claude.com/en/docs/claude-code/plugins)
  directories. Each bundles skills under `skills/<name>/SKILL.md`; the `Skill`
  tool is enabled automatically when any plugin is loaded. A worked example
  lives in [plugins/basicops-extras/](plugins/basicops-extras/).
- **`allowedTools`** — extra built-in tools to permit (advanced). The destructive
  BasicOps tools stay blocked regardless.

On startup the agent logs what it loaded, and on the first message it logs the
live skills + MCP server status (`[skills] …`, `[mcp] …`).

## How it works

- [src/basicops.ts](src/basicops.ts) — a tiny stateless MCP JSON-RPC client used
  for the deterministic provisioning calls.
- [src/funnel.ts](src/funnel.ts) — wraps `tailscale funnel` to expose the port
  and derive the public MagicDNS URL.
- [src/listener.ts](src/listener.ts) — the webhook server; generates replies with
  the Claude Agent SDK (per-chat memory, loop guard, destructive tools blocked).
- [src/config.ts](src/config.ts) — loads the optional per-agent capability file
  (extra MCP connectors + skill plugins).
- [src/cli.ts](src/cli.ts) — argument parsing and the connect sequence.

## Security notes

- Prefer `BASICOPS_API_KEY` over `--api-key` so the token isn't visible in `ps` / shell history.
- The agent is granted the whole BasicOps tool server **except** destructive tools
  (`delete_*`, `deactivate_user`, `reactivate_user`), which are blocked.
