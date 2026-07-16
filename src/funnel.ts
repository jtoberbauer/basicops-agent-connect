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
 * Build an actionable message for a failed `tailscale funnel` call. The common
 * cause on a fresh tailnet is that Funnel simply isn't enabled yet — a one-time
 * admin action Tailscale requires and that we cannot do for the user. We always
 * include the raw Tailscale output so unrelated failures stay visible.
 */
export function funnelHelp(raw: string): string {
  const link = raw.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0];
  return [
    "Couldn't open the Tailscale Funnel.",
    "",
    "This usually means Funnel isn't enabled on your tailnet yet. It has to be",
    "turned on once by the tailnet admin (it can't be enabled from here):",
    "",
    "  1. Enable HTTPS certificates:",
    "       https://login.tailscale.com/admin/dns  → turn on “HTTPS Certificates”",
    "  2. Enable Funnel — add this to your policy file at",
    "       https://login.tailscale.com/admin/acls :",
    '       "nodeAttrs": [{ "target": ["autogroup:member"], "attr": ["funnel"] }]',
    ...(link ? ["", `  Or use the link Tailscale printed: ${link}`] : []),
    "",
    "Then re-run this installer. To skip Tailscale entirely, pass",
    "  --webhook-url <your-own-public-https-url>",
    ...(raw ? ["", "Tailscale said:", ...raw.split(/\r?\n/).map((l) => `  ${l}`)] : []),
  ].join("\n");
}

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
    throw new Error("Could not determine Tailscale MagicDNS name. Is Tailscale logged in? Run `tailscale up`.");
  }

  try {
    await pexec(ts, ["funnel", "--bg", `--set-path=${path}`, String(port)]);
  } catch (e: any) {
    // Turn the raw "funnel not enabled" failure into actionable enable steps.
    const raw = `${e?.stdout ?? ""}${e?.stderr ?? ""}`.trim() || String(e?.message ?? e);
    throw new Error(funnelHelp(raw));
  }

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
