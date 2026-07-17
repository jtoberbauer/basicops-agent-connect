---
name: add-capability
description: Guide the person running this agent through adding a new skill or MCP connector, OR changing the agent's own instructions / behavior. Use this WHENEVER someone asks about giving you new abilities, connecting you to another tool or service, or changing how you behave — including "add a skill", "connect you to Gmail / Google Drive / Slack / GitHub / <any app>", "integrate with X", "give you access to X", "can you use X", "add an MCP server/connector", "how do I extend what you can do", AND "change your instructions", "update your instructions", "change your persona / tone / behavior", "always do X from now on", or "how do I tell you to behave differently". Prefer this skill over answering from general knowledge — it has the real, correct steps for THIS deployment; answering from memory produces wrong package names and paths.
---

# Guiding an operator to add a skill or MCP connector

You are a BasicOps agent. Your capabilities live in a config file **on the server
that runs you** — you cannot edit it yourself. Your job is to hand the operator a
**single copy-paste terminal command** that makes the change for them.

## The one hard rule: every command must be ONE line

**BasicOps messages collapse every newline to a space and strip code blocks/`<pre>`.**
So a command that relies on line breaks is destroyed the moment you post it. Therefore:

- **Write the whole command as a single line.** Chain steps with `&&`.
- **NEVER use a heredoc** (`<<'X' … X`). It needs a real newline on its own line, which
  BasicOps flattens — the command will hang or break when pasted.
- **For multi-line file content, use `printf` with literal `\n`** (backslash-n). The
  `\n` is two characters that survive flattening; `printf` turns them into newlines.
  Avoid `%` in printf'd content (or write it as `%%`).
- Deliver the command in a normal `<p>` — since it's one line, flattening does nothing
  to it. It will paste and run correctly.

Everything below is already written as a single line. Keep it that way.

## Other rules

- **Give runnable commands only** — never "open the file and edit…".
- **Fill in the real values** — the actual slug, connector name, researched URL/command,
  and (for a skill) the COMPLETE authored `SKILL.md` content. No `<placeholders>` except
  the one secret handled by `read`.
- **Merge, never overwrite** — the `node` snippets below preserve existing config.
- **Secrets via hidden prompt** — tokens go through `read -rs`; never ask for a token in
  chat, never echo it.
- **One tailored command per request.**

## Step 1 — find your slug

Call `get_agent_configuration` for your `agentId`; derive the slug (lowercase;
spaces/underscores → `-`; strip anything not `a-z0-9-`). `Claude-Agent` → `claude-agent`.
It names both the config file and the service. Use the real slug everywhere below
(shown here as `claude-agent`).

## Step 2 — research the REAL connector (for MCP requests)

Before writing anything, use `WebSearch` + `WebFetch` to find the official MCP server
for the named service and its *actual* endpoint (remote **HTTP url**, or **stdio**
`command`/`args`) and auth. Never invent a URL or package. If there's no official
server, say so and point to modelcontextprotocol.io.

## Step 3 — give the exact one-line command

### Add a remote HTTP MCP connector

Fill in `NAME`, the real URL, and the service name in the prompt:

`mkdir -p ~/.config/basicops-agent && read -rsp 'Paste the SERVICE token: ' TOKEN && echo && TOKEN="$TOKEN" node -e 'const fs=require("fs"),p=require("os").homedir()+"/.config/basicops-agent/claude-agent.json",c=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):{};(c.mcpServers=c.mcpServers||{})["NAME"]={type:"http",url:"REAL_URL",authToken:process.env.TOKEN};fs.writeFileSync(p,JSON.stringify(c,null,2));console.log("Updated "+p)' && sudo systemctl restart basicops-agent-claude-agent.service`

### Add a stdio MCP connector (runs a command on the box)

Warn them the command (e.g. `npx`, Docker) must be installed:

`mkdir -p ~/.config/basicops-agent && read -rsp 'Paste the SERVICE token: ' TOKEN && echo && TOKEN="$TOKEN" node -e 'const fs=require("fs"),p=require("os").homedir()+"/.config/basicops-agent/claude-agent.json",c=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):{};(c.mcpServers=c.mcpServers||{})["NAME"]={command:"npx",args:["-y","@scope/the-mcp-server"],env:{SOME_TOKEN:process.env.TOKEN}};fs.writeFileSync(p,JSON.stringify(c,null,2));console.log("Updated "+p)' && sudo systemctl restart basicops-agent-claude-agent.service`

### Add a skill

Author the WHOLE skill from their request (kebab-case name, a `description` that says
when to use it, and a real instruction body). Put the SKILL.md content into the `printf`
using `\n` for line breaks (no real newlines, no `%`). Example for a PDF-summary skill —
replace the name, description, and body with THEIR request:

`P=~/basicops-plugins/summarize-pdf && mkdir -p "$P/.claude-plugin" "$P/skills/summarize-pdf" && printf '%s' '{"name":"summarize-pdf","version":"0.1.0","description":"Summarize PDFs"}' > "$P/.claude-plugin/plugin.json" && printf -- '---\nname: summarize-pdf\ndescription: Summarize a PDF when the user shares a PDF or asks for its key points or TL;DR.\n---\n\n# Summarize a PDF\n\n1. Fetch the document (WebFetch for a URL).\n2. Give a 2-sentence TL;DR, then 3-6 key points, then any action items.\n3. Keep it under ~200 words; do not invent content.\n' > "$P/skills/summarize-pdf/SKILL.md" && node -e 'const fs=require("fs"),q=require("os").homedir()+"/.config/basicops-agent/claude-agent.json",c=fs.existsSync(q)?JSON.parse(fs.readFileSync(q,"utf8")):{};c.plugins=Array.from(new Set([...(c.plugins||[]),process.argv[1]]));fs.writeFileSync(q,JSON.stringify(c,null,2));console.log("Registered "+process.argv[1])' "$P" && sudo systemctl restart basicops-agent-claude-agent.service`

### Change my instructions (persona / behavior)

For "always do X", tone, or defaults — NOT one-off requests, which you just do. Put the
full instruction text into the `printf` with `\n` between lines:

`printf 'Always be concise and lead with the answer.\nNever change a task assignee unless explicitly asked.\n' > /tmp/boi && node -e 'const fs=require("fs"),p=require("os").homedir()+"/.config/basicops-agent/claude-agent.json",c=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):{};c.instructions=fs.readFileSync("/tmp/boi","utf8").trim();fs.writeFileSync(p,JSON.stringify(c,null,2));console.log("Updated "+p)' && rm -f /tmp/boi && sudo systemctl restart basicops-agent-claude-agent.service`

There is only one `instructions` field, so this replaces the previous value. To keep the
old instructions and add to them, include both in the `printf`.

## Step 4 — what success looks like

Tell them that after it runs, they can check it loaded with (also one line):

`journalctl -u basicops-agent-claude-agent -n 20 --no-pager | grep -Ei 'connector|skill|instructions|live'`

They should see `Extra MCP connectors: …`, `Skill plugins: …`, and/or `Custom
instructions: N chars`. Then have them send you a new message to test. (If they don't run
the persistent service, the restart is: stop the running `basicops-connect` and start it
again.)
