#!/usr/bin/env bash
#
# Install a BasicOps agent as a systemd service so it survives logout/reboot.
# Reads BASICOPS_API_KEY and BASICOPS_AGENT from the environment.
# Run via the installer, or directly:
#   BASICOPS_API_KEY=... BASICOPS_AGENT=my-agent bash scripts/install-service.sh
#
set -euo pipefail

AGENT="${BASICOPS_AGENT:?BASICOPS_AGENT not set}"
: "${BASICOPS_API_KEY:?BASICOPS_API_KEY not set}"

# Slug for the env file + unit name (lowercase, safe chars) — allows multiple agents.
SLUG="$(printf '%s' "$AGENT" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-')"
[ -n "$SLUG" ] || SLUG="agent"

BIN="$(command -v basicops-connect || true)"
if [ -z "$BIN" ]; then
  NPM_PREFIX="$(npm prefix -g 2>/dev/null || true)"
  [ -n "$NPM_PREFIX" ] && [ -x "$NPM_PREFIX/bin/basicops-connect" ] && BIN="$NPM_PREFIX/bin/basicops-connect"
fi
[ -n "$BIN" ] || { echo "✗ basicops-connect not found (run 'npm link' in the repo first)"; exit 1; }
BIN_DIR="$(dirname "$BIN")"
NODE_DIR="$(dirname "$(command -v node)")"
CLAUDE_DIR="$(dirname "$(command -v claude 2>/dev/null || echo /usr/bin/claude)")"
TS_DIR="$(dirname "$(command -v tailscale 2>/dev/null || echo /usr/bin/tailscale)")"
USER_NAME="$(id -un)"
HOME_DIR="$HOME"

ENVDIR="$HOME/.config/basicops-agent"
ENVFILE="$ENVDIR/$SLUG.env"
mkdir -p "$ENVDIR"; chmod 700 "$ENVDIR"
( umask 077; cat > "$ENVFILE" <<EOF
BASICOPS_API_KEY=$BASICOPS_API_KEY
BASICOPS_AGENT=$AGENT
EOF
)
echo "✓ wrote credentials to $ENVFILE (mode 600)"

UNIT="basicops-agent-$SLUG.service"
PATH_LINE="$BIN_DIR:$NODE_DIR:$CLAUDE_DIR:$TS_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

echo "Installing $UNIT (sudo may prompt)…"
sudo tee "/etc/systemd/system/$UNIT" >/dev/null <<EOF
[Unit]
Description=BasicOps agent ($AGENT)
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
Environment=HOME=$HOME_DIR
Environment=PATH=$PATH_LINE
EnvironmentFile=$ENVFILE
ExecStart=$BIN
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now "$UNIT"
echo
echo "✓ $UNIT installed and started."
echo "  Logs:    journalctl -u $UNIT -f"
echo "  Restart: sudo systemctl restart $UNIT"
echo "  Stop:    sudo systemctl stop $UNIT"
