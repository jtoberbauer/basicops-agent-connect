/**
 * Tailscale Funnel automation. Exposes a local port to the public internet over
 * HTTPS at a path on the shared :443 Funnel, so multiple agents can run on one
 * machine concurrently. Tailscale strips the path prefix before proxying, so the
 * listener still receives "/webhook".
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";

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

/** Spawn a tailscale command inheriting the terminal (for auth / sudo prompts). */
function spawnInherit(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`\`${cmd} ${args.join(" ")}\` exited with code ${code}`))));
  });
}

/**
 * Run `tailscale up` interactively. On Linux we set `--operator=<user>` so the
 * agent's own (non-root) user may manage Funnel afterward — otherwise
 * `tailscale funnel` is denied ("serve config denied") and the whole setup fails.
 */
export async function tailscaleUp(): Promise<void> {
  const ts = await resolveTailscale();
  const user = os.userInfo().username;
  if (process.platform === "linux") return spawnInherit("sudo", [ts, "up", `--operator=${user}`]);
  return spawnInherit(ts, ["up"]);
}

/** Grant the current (non-root) user permission to manage Funnel/Serve. */
export async function setTailscaleOperator(): Promise<void> {
  const ts = await resolveTailscale();
  const user = os.userInfo().username;
  if (process.platform === "linux") return spawnInherit("sudo", [ts, "set", `--operator=${user}`]);
  return spawnInherit(ts, ["set", `--operator=${user}`]);
}

/** True if a funnel failure is a permission/operator issue (fixable via operator). */
export function isOperatorError(out: string): boolean {
  return /serve config denied|access denied|--operator|not require root|permission denied/i.test(out);
}

/**
 * Run `tailscale funnel …` without hanging. On a Funnel-DISABLED tailnet the
 * command prints "Funnel is not enabled…" (with an enable URL) and then blocks
 * indefinitely — it does NOT wait on stdin and does NOT exit. So we watch its
 * output and abort the instant we see that signal, giving immediate guidance
 * instead of a long stall. The timeout only backstops other stalls (e.g. a slow
 * first-time TLS cert on an ENABLED tailnet — hence generous). Resolves
 * {ok, out}; never rejects.
 */
function funnelExec(ts: string, args: string[], timeoutMs = 60000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(ts, ["funnel", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      resolve({ ok, out: out.trim() });
    };
    const onData = (d: Buffer) => {
      out += d.toString();
      if (/not enabled|\/f\/funnel|funnel\?node=/i.test(out)) finish(false); // don't wait — it never exits
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.on("error", () => finish(false));
    child.on("exit", (code) => finish(code === 0));
  });
}

/**
 * Probe whether Funnel is permitted on this tailnet, without needing the real
 * listener: briefly register a throwaway funnel mount and remove it. Success
 * means Funnel is enabled; a failure returns the raw Tailscale output (for
 * guidance). This is how we catch a brand-new tailnet where Funnel isn't enabled.
 */
export async function funnelAvailable(): Promise<{ ok: boolean; error?: string }> {
  const ts = await resolveTailscale();
  const probe = "/__basicops_preflight__";
  const r = await funnelExec(ts, ["--bg", `--set-path=${probe}`, "1"]);
  if (r.ok) {
    await funnelExec(ts, [`--set-path=${probe}`, "off"], 8000); // remove the probe mount
    return { ok: true };
  }
  return { ok: false, error: r.out };
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

  // Fail-fast on "not enabled" (never hangs); turn it into actionable steps.
  const r = await funnelExec(ts, ["--bg", `--set-path=${path}`, String(port)]);
  if (!r.ok) throw new Error(funnelHelp(r.out));

  return {
    url: `https://${dns}${path}`,
    stop: async () => {
      await funnelExec(ts, [`--set-path=${path}`, "off"], 8000); // best effort
    },
  };
}
