---
name: add-capability
description: Guide the person running this agent through adding a new skill or MCP connector to it. Use this WHENEVER someone asks about giving you new abilities or connecting you to another tool or service — including "add a skill", "connect you to Gmail / Google Drive / Slack / GitHub / <any app>", "integrate with X", "give you access to X", "can you use X", "hook you up to X", "add an MCP server/connector", or "how do I extend what you can do". Prefer this skill over answering from general knowledge — it has the real, correct setup steps for THIS deployment; answering from memory produces wrong package names and paths.
---

# Guiding an operator to add a skill or MCP connector

You are a BasicOps agent. Your capabilities live in a config file **on the server
that runs you** — you cannot edit it yourself. Your job is to hand the operator
**complete, copy-paste terminal commands** that make the change for them.

## Hard rules for your reply

- **Give runnable commands only.** Never say "open the file and add…", "edit the
  JSON", or "paste this into the config". Every change must be a shell command they
  can paste as-is. Assume they will copy one block and run it.
- **Fill in the real values.** Use the actual slug, connector name, and researched
  URL/command — no `<placeholders>` except the one secret handled by `read`. For a
  **skill**, write the COMPLETE `SKILL.md` content — a real `name`, a real
  `description` (the trigger), and the full instruction body tailored to exactly
  what they asked for. Never hand back `SKILL_NAME` or "step-by-step instructions
  here" — author the actual skill.
- **Merge, never overwrite.** Always use the `node` one-liners below (node is
  guaranteed installed — it runs this agent). They preserve existing config.
- **Secrets via hidden prompt, never in chat.** Tokens are entered locally with
  `read -rs`; never ask the user to paste a token into BasicOps, and never echo it.
- **One tailored block per request.** If they asked for a connector, give the
  connector block only; for a skill, the skill block only.

## Step 1 — find your slug

Call `get_agent_configuration` to get your `agentId`; derive the slug (lowercase;
spaces/underscores → `-`; strip anything not `a-z0-9-`). Example: `Claude-Agent` →
`claude-agent`. It names both the config file and the systemd service. Use the real
slug in every command below (shown here as `claude-agent`).

## Step 2 — research the REAL connector (for MCP requests)

Before writing anything, use `WebSearch` + `WebFetch` to find the official MCP
server for the named service and read its docs for the *actual* endpoint and auth:
- a remote **HTTP url**, or a **stdio** `command`/`args` (many are stdio via
  `npx`/Docker and must be installed on the box);
- what token/OAuth it needs and where to get it.

Never invent a URL or package. If there's no official server, say so and link the
directory (modelcontextprotocol.io) instead of guessing.

## Step 3 — give the exact commands

### Add a remote HTTP MCP connector

Reply with a block like this, with `NAME`, the URL, and the service name filled in:

````bash
mkdir -p ~/.config/basicops-agent
read -rsp 'Paste the SERVICE token, then Enter: ' TOKEN && echo
TOKEN="$TOKEN" node -e '
const fs=require("fs"), p=require("os").homedir()+"/.config/basicops-agent/claude-agent.json";
const c=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):{};
(c.mcpServers=c.mcpServers||{})["NAME"]={type:"http",url:"REAL_URL_HERE",authToken:process.env.TOKEN};
fs.writeFileSync(p,JSON.stringify(c,null,2)); console.log("Updated "+p);'
sudo systemctl restart basicops-agent-claude-agent.service
sleep 3 && journalctl -u basicops-agent-claude-agent -n 20 --no-pager | grep -Ei "connector|skill|live"
````

### Add a stdio MCP connector (runs a command on the box)

Warn them the command (e.g. `npx`, Docker) must be installed. Same pattern:

````bash
mkdir -p ~/.config/basicops-agent
read -rsp 'Paste the SERVICE token, then Enter: ' TOKEN && echo
TOKEN="$TOKEN" node -e '
const fs=require("fs"), p=require("os").homedir()+"/.config/basicops-agent/claude-agent.json";
const c=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):{};
(c.mcpServers=c.mcpServers||{})["NAME"]={command:"npx",args:["-y","@scope/the-mcp-server"],env:{SOME_TOKEN:process.env.TOKEN}};
fs.writeFileSync(p,JSON.stringify(c,null,2)); console.log("Updated "+p);'
sudo systemctl restart basicops-agent-claude-agent.service
sleep 3 && journalctl -u basicops-agent-claude-agent -n 20 --no-pager | grep -Ei "connector|skill|live"
````

### Add a skill

**Write the whole skill for them.** From their request, compose: a short kebab-case
skill name, a one-line `description` that says exactly WHEN you should use the skill
(these are the trigger phrases — make them match how they'd actually ask), and a
complete instruction body with concrete steps. If the skill needs domain facts
(an API shape, a format), `WebSearch`/`WebFetch` them first so the body is correct.
Then bake all of that directly into the heredoc below — the operator runs it as-is.

Everything in this block is filled in with real content (name, description, body)
except nothing — there are no fields left for them to edit:

````bash
PLUG=~/basicops-plugins/pdf-summary
mkdir -p "$PLUG/.claude-plugin" "$PLUG/skills/summarize-pdf"
cat > "$PLUG/.claude-plugin/plugin.json" <<'JSON'
{ "name": "pdf-summary", "version": "0.1.0", "description": "Summarize PDFs shared in chat" }
JSON
cat > "$PLUG/skills/summarize-pdf/SKILL.md" <<'MD'
---
name: summarize-pdf
description: Summarize a PDF when the user shares a PDF file or link, or asks for the key points, TL;DR, or action items of a document.
---

# Summarize a PDF

1. Fetch the document (use WebFetch for a URL; for an uploaded file use the file
   the user provided).
2. Produce a tight summary: a 2-sentence TL;DR, then 3-6 bullet key points, then
   any action items or decisions.
3. Keep it under ~200 words unless they ask for more. Do not invent content that
   isn't in the document.
MD
node -e '
const fs=require("fs"), p=require("os").homedir()+"/.config/basicops-agent/claude-agent.json";
const dir=process.argv[1];
const c=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):{};
c.plugins=Array.from(new Set([...(c.plugins||[]),dir]));
fs.writeFileSync(p,JSON.stringify(c,null,2)); console.log("Registered "+dir);' "$PLUG"
sudo systemctl restart basicops-agent-claude-agent.service
sleep 3 && journalctl -u basicops-agent-claude-agent -n 20 --no-pager | grep -Ei "connector|skill|live"
````

That example is for a PDF-summary request — replace the plugin dir, skill name,
description, and body with content authored for THEIR actual request. Any tools the
new skill relies on (e.g. `WebFetch`) must be ones the agent already has, or a
connector added separately.

## Step 4 — what success looks like

Tell them the final `journalctl` line should print `Extra MCP connectors: …` and/or
`Skill plugins: …`, then to send you a new message to try it. If instead they don't
run the persistent service, the restart command is: stop the running
`basicops-connect` and start it again.
