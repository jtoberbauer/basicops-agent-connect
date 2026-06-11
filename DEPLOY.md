# Deploying to a server (new user)

Get a persistent, Claude-powered BasicOps agent running on a fresh Debian/Ubuntu
server.

## Before you start, have these ready
- A **BasicOps agent** (created in the BasicOps UI) and its **API key**
- A **Claude subscription** (you'll log in during install)
- A **Tailscale account** (free) — used to expose the webhook
- Access to this repo

## Deploy

```bash
gh repo clone jtoberbauer/basicops-agent-connect
cd basicops-agent-connect
bash scripts/setup-vps.sh
```

`setup-vps.sh` does the whole thing: installs Node + Tailscale + the Claude CLI,
builds, connects Tailscale (approve in your browser), then launches the
installer, which prompts:

```
  BasicOps agent API key:  (hidden)   ← the agent is auto-detected from this key
  Checking Claude login…   → runs the Claude OAuth login if needed (open the URL)
  Run as a background service (survives logout/reboot)? [Y/n]  → Y
  (sudo password once)
```

That installs a **systemd service** and starts it. Done — the agent runs 24/7,
restarts on crash, and survives reboots.

## Manage it

```bash
systemctl status basicops-agent-<agent>      # health
journalctl -u basicops-agent-<agent> -f      # live logs
sudo systemctl restart basicops-agent-<agent>
```

Credentials live in `~/.config/basicops-agent/<agent>.env` (mode 600).

## Note on Claude auth
The agent uses your Claude **subscription login**, which can expire over time. If
the agent goes quiet, re-run `basicops-connect` (it re-validates and re-logs-in)
or `claude auth login`. For an auth method that never expires, see the
OpenAI-powered build (`basicops-agent-connect-openai`), which uses an API key.

## Multiple agents
Each distinct agent name gets its own Funnel path and its own service, so several
agents coexist on one box.
