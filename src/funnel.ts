/**
 * Tailscale Funnel automation. Exposes a local port to the public internet over
 * HTTPS at a path on the shared :443 Funnel, so multiple agents can run on one
 * machine concurrently. Tailscale strips the path prefix before proxying, so the
 * listener still receives "/webhook".
 */
import { execFile, spawn } from "node:child_process";
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

/** Current Tailscale backend state + MagicDNS name (for readiness checks). */
export async function tailscaleStatus(): Promise<{ installed: boolean; backendState: string; dns?: string }> {
  let ts: string;
  try {
    ts = await resolveTailscale();
  } catch {
    return { installed: false, backendState: "NotInstalled" };
  }
  try {
    const { stdout } = await pexec(ts, ["status", "--json"]);
    const s = JSON.parse(stdout);
    const dns = String(s?.Self?.DNSName ?? "").replace(/\.$/, "");
    return { installed: true, backendState: String(s?.BackendState ?? "Unknown"), dns: dns || undefined };
  } catch {
    return { installed: true, backendState: "Stopped" };
  }
}

/** Run `tailscale up` interactively (inherits the terminal for the browser auth). */
export async function tailscaleUp(): Promise<void> {
  const ts = await resolveTailscale();
  const [cmd, args] = process.platform === "linux" ? ["sudo", [ts, "up"]] : [ts, ["up"]];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`\`tailscale up\` exited with code ${code}`))));
  });
}

/**
 * Run `tailscale funnel …` with **stdin closed** and a timeout. Critical: on a
 * Funnel-disabled tailnet, `tailscale funnel` prints an interactive
 * "enable Funnel? [y/N]" prompt and blocks. Closing stdin gives it EOF so it
 * aborts (non-zero) instead of hanging; the timeout is a backstop. On success it
 * resolves; on failure it rejects with the combined output for guidance.
 */
function runFunnel(ts: string, args: string[], timeoutMs = 45000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ts, ["funnel", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(out.trim() || "`tailscale funnel` timed out with no response (is Funnel enabled?)"));
    }, timeoutMs);
    child.on("error", (e) => (clearTimeout(timer), reject(e)));
    child.on("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(out.trim() || `\`tailscale funnel\` exited with code ${code}`));
    });
  });
}

/**
 * Probe whether Funnel is permitted on this tailnet, without needing the real
 * listener: briefly register a throwaway funnel mount and remove it. Success
 * means Funnel is enabled; failure returns the raw error (for guidance). This is
 * how we catch a brand-new tailnet where Funnel hasn't been enabled yet.
 */
export async function funnelAvailable(): Promise<{ ok: boolean; error?: string }> {
  const ts = await resolveTailscale();
  const probe = "/__basicops_preflight__";
  try {
    await runFunnel(ts, ["--bg", `--set-path=${probe}`, "1"]);
    await runFunnel(ts, [`--set-path=${probe}`, "off"]).catch(() => {}); // clean up
    return { ok: true };
  } catch (e: any) {
    await runFunnel(ts, [`--set-path=${probe}`, "off"]).catch(() => {}); // best-effort
    return { ok: false, error: String(e?.message ?? e) };
  }
}

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
    // stdin-closed + timeout: never hang on the "enable Funnel? [y/N]" prompt.
    await runFunnel(ts, ["--bg", `--set-path=${path}`, String(port)]);
  } catch (e: any) {
    // Turn the raw "funnel not enabled" failure into actionable enable steps.
    throw new Error(funnelHelp(String(e?.message ?? e)));
  }

  return {
    url: `https://${dns}${path}`,
    stop: async () => {
      await runFunnel(ts, [`--set-path=${path}`, "off"]).catch(() => {}); // best effort
    },
  };
}
