// NO KEY IN THE REPOSITORY (R40 — the fresh audit's OPS11-16).
//
//   node scripts/secrets.audit.mjs
//
// .gitignore covered .env* and *.pem, and nothing else: the Apple keys this business handles by hand — the APNs and
// Sign in with Apple keys (AuthKey_XXXX.p8), a distribution certificate (.p12), a provisioning profile — were one
// `git add -A` from main and every clone, the day one was downloaded into the project's folder to paste into GitHub. The
// patterns are in .gitignore now; this is the check behind them, run with every audit and in CI:
//
//   · NAMED LIKE A KEY: no tracked file is a key file by its name (*.p8, *.p12, *.pfx, *.key, *.mobileprovision, *.pem,
//     AuthKey_*, an .env file but .env.example).
//   · HOLDING ONE: no tracked text file holds a private key's block, a live payment key (Stripe sk_live_/rk_live_, a
//     Square production token), a cloud or code-host token (AWS AKIA…, GitHub gh?_…, Slack xox?-…), or a Supabase key
//     whose own payload says it is the service role. A JWT is decoded to read its role, so the public anon key — public by
//     design, and in one migration's trigger (0157) — is not a finding, and the service role's would be.
//
// What it prints is the file, the line and the kind — never what matched (a key in a log is a key leaked twice).
// Every key in this repository's tests is made up and says so (made-up, made_up, test): test-mode keys are not findings.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A file named as a key file is: its kind, or null. Pure. */
export function keyFileKind(path) {
  const name = basename(path);
  if (/^AuthKey_[A-Za-z0-9]+\.p8$/i.test(name) || /\.p8$/i.test(name)) return "an Apple key (.p8)";
  if (/\.(p12|pfx)$/i.test(name)) return "a certificate with its private key (.p12)";
  if (/\.mobileprovision$/i.test(name)) return "a provisioning profile";
  if (/\.key$/i.test(name)) return "a key file (.key)";
  if (/\.pem$/i.test(name)) return "a PEM file";
  if (/^\.env(\..+)?$/.test(name) && name !== ".env.example") return "an environment file";
  return null;
}

const b64url = (s) => { try { return JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); } catch { return null; } };

/** The kinds of secret a text holds, with their lines — never the text matched. Pure. */
export function secretsIn(text) {
  const found = [];
  const lines = text.split("\n");
  // A private key's block, not its header: code that writes a key from a secret names the header too (ios.yml, lib/appleKey)
  // — a key is the header and its body, 64-character lines of base64, on the lines after it or after a "\n" on the same one.
  const HEADER = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/;
  const BODY = /^[A-Za-z0-9+/]{60,}={0,2}$/;
  lines.forEach((line, i) => {
    if (!HEADER.test(line)) return;
    const after = line.slice(line.search(HEADER));
    const sameLine = /PRIVATE KEY-----(?:\\n|\\r\\n)[A-Za-z0-9+/]{60,}/.test(after);
    const nextLines = lines.slice(i + 1, i + 4).some((l) => BODY.test(l.trim()));
    if (sameLine || nextLines) found.push({ line: i + 1, kind: "a private key" });
  });
  const rules = [
    [/\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/, "a live Stripe key"],
    [/\bEAAA[A-Za-z0-9_-]{50,}/, "a Square production access token"],
    [/\bsq0csp-[A-Za-z0-9_-]{20,}/, "a Square application secret"],
    [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key"],
    [/\bgh[pousr]_[A-Za-z0-9]{36,}/, "a GitHub token"],
    [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  ];
  lines.forEach((line, i) => {
    for (const [re, kind] of rules) if (re.test(line)) found.push({ line: i + 1, kind });
    // A Supabase key is a JWT: its payload says its role. The service role's opens every table past every policy.
    for (const m of line.matchAll(/\beyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g)) {
      const payload = b64url(m[1]);
      if (payload && payload.role === "service_role") found.push({ line: i + 1, kind: "a Supabase service-role key" });
    }
  });
  return found;
}

/** What would ship: the repository's tracked files and the new ones `git add -A` would take (not ignored) — git's own
 *  list — or null outside a checkout. */
function tracked() {
  try { return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean); }
  catch { return null; }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const files = tracked();
  if (!files) { console.log("SECRETS AUDIT: NOT CHECKED — not a git checkout, so there is no list of what ships. Treated as a failure."); process.exit(1); }
  const named = [], held = [];
  let read = 0;
  for (const f of files) {
    const kind = keyFileKind(f);
    if (kind) named.push(`${f} — ${kind}`);
    let st; try { st = statSync(join(ROOT, f)); } catch { continue; }   // deleted in the work tree, not yet committed
    if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;
    const buf = readFileSync(join(ROOT, f));
    if (buf.includes(0)) continue;   // binary: no text to hold a key in
    read++;
    for (const s of secretsIn(buf.toString("utf8"))) held.push(`${f}:${s.line} — ${s.kind}`);
  }
  console.log(`SECRETS AUDIT: ${files.length} files git would ship (${read} read as text) — ${named.length} named as a key file, ${held.length} holding a secret.`);
  for (const n of named) console.log(`  ✗ named as a key file: ${n}`);
  for (const h of held) console.log(`  ✗ holds ${h}`);
  if (named.length || held.length) {
    console.log("    Take it out of the repository (git rm --cached <file>), rotate the key — a key that reached git has left — and keep it where it belongs: GitHub's or Supabase's secrets, or Passwords.");
    process.exit(1);
  }
}
