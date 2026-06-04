/**
 * Tailscale Funnel automation. Exposes a local port to the public internet over
 * HTTPS at a path on the shared :443 Funnel, so multiple agents can run on one
 * machine concurrently. Tailscale strips the path prefix before proxying, so the
 * listener still receives "/webhook".
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

const TAILSCALE_CANDIDATES = [
  "tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/local/bin/tailscale",
  "/usr/bin/tailscale",
];

async function resolveTailscale(): Promise<string> {
  for (const bin of TAILSCALE_CANDIDATES) {
    try {
      await pexec(bin, ["version"]);
      return bin;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "tailscale CLI not found. Install Tailscale, or pass --webhook-url to skip Funnel.",
  );
}

export type Funnel = { url: string; stop: () => Promise<void> };

/**
 * Mount http://localhost:<port> at <path> on the public :443 Funnel.
 * Multiple agents each use their own <path> (e.g. "/claude", "/support-bot")
 * and coexist. Stopping one removes only its mount.
 */
export async function startFunnel(port: number, path: string): Promise<Funnel> {
  const ts = await resolveTailscale();

  const { stdout } = await pexec(ts, ["status", "--json"]);
  const status = JSON.parse(stdout);
  const dns = String(status?.Self?.DNSName ?? "").replace(/\.$/, "");
  if (!dns) {
    throw new Error("Could not determine Tailscale MagicDNS name. Is Tailscale logged in?");
  }

  await pexec(ts, ["funnel", "--bg", `--set-path=${path}`, String(port)]);

  return {
    url: `https://${dns}${path}`,
    stop: async () => {
      try {
        await pexec(ts, ["funnel", `--set-path=${path}`, "off"]);
      } catch {
        /* best effort */
      }
    },
  };
}
