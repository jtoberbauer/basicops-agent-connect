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
# Use a user-level npm global prefix so `npm link` works WITHOUT root. A stock
# NodeSource install uses the /usr prefix (root-owned), where `npm link` fails
# with EACCES for a normal user. Point the global prefix at ~/.npm-global and put
# it on PATH (persisted for future shells + the systemd unit picks it up).
NPM_PREFIX="$HOME/.npm-global"
mkdir -p "$NPM_PREFIX"
npm config set prefix "$NPM_PREFIX"
export PATH="$NPM_PREFIX/bin:$PATH"
if ! grep -q '.npm-global/bin' "$HOME/.profile" 2>/dev/null; then
  echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$HOME/.profile"
fi

say "Installing deps + building…"
npm install
npm run build
npm link

# 5. Ensure Tailscale is connected (needed for the public webhook Funnel)
if ! tailscale status --json 2>/dev/null | grep -q '"BackendState": *"Running"'; then
  say "Connecting Tailscale — approve in your browser when prompted…"
  sudo tailscale up || { echo "✗ Tailscale didn't come up. Run 'sudo tailscale up', then 'basicops-connect'."; exit 1; }
fi

# 6. Launch the interactive installer (prompts for key + agent, handles the
#    Claude login, and offers to install a persistent service).
say "Launching the installer…"
exec node "$(pwd)/dist/bin.js"
