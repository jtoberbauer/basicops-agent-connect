---
name: add-capability
description: Guide the person running this agent through adding a new skill or MCP connector to it. Use this WHENEVER someone asks about giving you new abilities or connecting you to another tool or service — including "add a skill", "connect you to Gmail / Google Drive / Slack / GitHub / <any app>", "integrate with X", "give you access to X", "can you use X", "hook you up to X", "add an MCP server/connector", or "how do I extend what you can do". Prefer this skill over answering from general knowledge — it has the real, correct setup steps for THIS deployment (config file path, JSON shape, restart command); answering from memory produces wrong package names and paths.
---

# Guiding an operator to add a skill or MCP connector

You are a BasicOps agent. Your own capabilities (extra MCP connectors and skills)
are controlled by a config file **on the server that runs you** — you cannot edit
it yourself, and that's intentional. Your job here is to give the operator clear,
correct, copy-pasteable instructions so **they** make the change. Never ask for or
accept secrets (API tokens) in chat — tell them where to put those on the server.

## First, personalize the instructions

1. Call `get_agent_configuration` to get your own `agentId`.
2. Derive your **slug** from it: lowercase, replace spaces and underscores with
   `-`, drop anything that isn't `a-z`, `0-9`, or `-`. Example: `Claude-Agent` →
   `claude-agent`. This slug is used for both your config filename and your
   service name. (If unsure, tell them to run `ls ~/.config/basicops-agent/` — the
   existing `<slug>.env` file confirms the slug.)

Use that slug to fill in `<slug>` everywhere below.

## The config file

Tell them the config lives at `~/.config/basicops-agent/<slug>.json` (create it if
it doesn't exist). All keys are optional. Give them only the part they asked for.

**First, look up the REAL connector details — do not guess them.** You have
`WebSearch` and `WebFetch`. Before writing any config, search for the official MCP
server for the service the user named (e.g. "official Gmail MCP server",
"GitHub MCP server url"), and `WebFetch` its docs/README to get the *actual*:
- transport and endpoint — a remote **HTTP url**, or a **stdio** `command`/`args`
  (many official servers are stdio, e.g. run via `npx`/Docker on the box);
- what auth it needs (token/OAuth) and how to obtain it.
Never invent a URL or package name. If you can't find an official server, say so
plainly and point them at the MCP directory (e.g. modelcontextprotocol.io) rather
than making one up.

**To add an MCP connector** (remote HTTP with a bearer token shown here; use the
real values you found above):

```json
{
  "mcpServers": {
    "CONNECTOR_NAME": {
      "type": "http",
      "url": "https://THE-MCP-SERVER/URL",
      "authToken": "PUT_TOKEN_HERE_ON_THE_SERVER"
    }
  }
}
```

- `CONNECTOR_NAME` is any short name they choose; it becomes the tool prefix
  `mcp__CONNECTOR_NAME`, allowed automatically.
- The `authToken` is sent as `Authorization: Bearer …`. Remind them to paste the
  real token **into the file on the server**, not into this chat.

If the official server is **stdio** (runs as a command on the box), use this shape
instead — and warn them the command must be installed on the server:

```json
{
  "mcpServers": {
    "CONNECTOR_NAME": {
      "command": "npx",
      "args": ["-y", "@scope/the-mcp-server"],
      "env": { "SOME_TOKEN": "PUT_TOKEN_HERE_ON_THE_SERVER" }
    }
  }
}
```

**To add a skill**, skills live inside a *plugin folder*. Simplest path — reuse the
bundled example folder, or point at their own:

```json
{
  "plugins": ["/ABSOLUTE/PATH/TO/basicops-agent-connect/plugins/basicops-extras"]
}
```

Then a skill is a folder with a single Markdown file:

```
<plugin-folder>/skills/<skill-name>/SKILL.md
```

`SKILL.md` needs YAML frontmatter and instructions:

```markdown
---
name: my-skill
description: One line telling the agent WHEN to use this skill.
---

# What to do
Step-by-step instructions for the agent...
```

If they already have both `mcpServers` and `plugins`, they go in the **same** JSON
object — don't tell them to create two files.

## Apply the change

The agent only reads config at startup, so a restart is required:

```bash
sudo systemctl restart basicops-agent-<slug>.service
```

(If they didn't install the persistent service, they instead stop and re-run
`basicops-connect`.)

## Confirm it worked

- The startup log lists what loaded — `journalctl -u basicops-agent-<slug> -n 20`
  should show `Extra MCP connectors: …` and/or `Skill plugins: …`.
- On the next message you receive, the log prints `[mcp] …` and `[skills] …` with
  live status.
- Have them send you a new message to test the new ability.

## Tone

Be concise and concrete. Give the exact file path, the exact JSON, and the exact
restart command for **their** slug — not a generic explanation. If they only asked
about a connector, don't dump the skill instructions too, and vice-versa.
