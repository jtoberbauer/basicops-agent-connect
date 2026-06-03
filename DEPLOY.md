# Deploying to a server

The package runs the same everywhere. It relies on two ambient dependencies
that must exist on the machine (your laptop already had them):

1. **Tailscale, logged in** — used to expose the webhook via Funnel.
2. **Claude auth** — the listener calls Claude to generate replies (subscription
   via the `claude` CLI, or `ANTHROPIC_API_KEY`).

Once both are present, the **same command** produces the **same outcome**.

## Quick start (Debian/Ubuntu VPS)

```bash
gh repo clone jtoberbauer/basicops-agent-connect   # or: git clone <ssh-url>
cd basicops-agent-connect
bash scripts/setup-vps.sh                           # installs deps, builds, links
```

Then the two one-time logins the script prints:

```bash
tailscale up            # join your tailnet
claude                  # log into Claude; verify:  claude -p "say ok"
```

Run it (identical to local):

```bash
basicops-connect --api-key <KEY> --agent <NAME>
```

That's the whole test loop. No domain or reverse proxy needed — the built-in
Tailscale Funnel provides the public HTTPS URL.

## Keeping it running (optional)

```ini
# /etc/systemd/system/basicops-agent.service
[Service]
ExecStart=%h/.npm-global/bin/basicops-connect --agent <NAME>
Environment=BASICOPS_API_KEY=<KEY>
WorkingDirectory=%h/basicops-agent-connect
Restart=always
User=<youruser>

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now basicops-agent
journalctl -u basicops-agent -f
```

Set `ExecStart` to match `which basicops-connect` on the box. Using
`Environment=BASICOPS_API_KEY=…` keeps the key out of `ps`.
```
