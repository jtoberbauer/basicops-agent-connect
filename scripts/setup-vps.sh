#!/usr/bin/env bash
#
# One-shot VPS setup for basicops-agent-connect (Debian/Ubuntu).
# Run this from the repo root after cloning:
#
#   git clone <repo> && cd basicops-agent-connect && bash scripts/setup-vps.sh
#
# It installs the ambient dependencies the package relies on (Node 20+,
# Tailscale, Claude CLI), then builds and links the CLI. Two interactive
# logins remain afterward (tailscale + claude) — it prints those at the end.

set -euo pipefail

say() { printf "\n\033[36m==> %s\033[0m\n" "$1"; }

# 1. Node 20+
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//; s/\..*//')" -lt 20 ]; then
  say "Installing Node 20 (NodeSource)…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
say "Node $(node -v)"

# 2. Tailscale (for the public webhook URL via Funnel)
if ! command -v tailscale >/dev/null 2>&1; then
  say "Installing Tailscale…"
  curl -fsSL https://tailscale.com/install.sh | sh
fi
say "Tailscale $(tailscale version | head -1)"

# 3. Claude CLI (Agent SDK uses its subscription credentials)
if ! command -v claude >/dev/null 2>&1; then
  say "Installing Claude CLI…"
  sudo npm install -g @anthropic-ai/claude-code
fi
say "Claude CLI $(claude --version 2>/dev/null || echo installed)"

# 4. Build & link the package
say "Installing deps + building…"
npm install
npm run build
npm link

say "Setup complete."
cat <<'NEXT'

Two one-time logins remain (both interactive, need a browser to approve once):

  1) tailscale up        # join your tailnet
  2) claude              # log into Claude (subscription); verify with:  claude -p "say ok"

Then run the exact same command you ran locally:

  basicops-connect --api-key <KEY> --agent <NAME>

NEXT
