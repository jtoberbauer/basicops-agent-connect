/**
 * Tailscale Funnel automation. Exposes a local port to the public internet over
 * HTTPS and derives the public MagicDNS URL, so BasicOps can reach the webhook.
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

/** Open a Funnel proxying public HTTPS (443) to http://localhost:<port>. */
export async function startFunnel(port: number): Promise<Funnel> {
  const ts = await resolveTailscale();

  const { stdout } = await pexec(ts, ["status", "--json"]);
  const status = JSON.parse(stdout);
  const dns = String(status?.Self?.DNSName ?? "").replace(/\.$/, "");
  if (!dns) {
    throw new Error("Could not determine Tailscale MagicDNS name. Is Tailscale logged in?");
  }

  await pexec(ts, ["funnel", "--bg", String(port)]);

  return {
    url: `https://${dns}`,
    stop: async () => {
      try {
        await pexec(ts, ["funnel", "--https=443", "off"]);
      } catch {
        /* best effort */
      }
    },
  };
}
