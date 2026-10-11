// THE IOS PROJECT AND THE IPHONE CHECK, PROVED BOTH WAYS (2026-10-11, the app runs on an iPad).
//
//   node scripts/ios.test.mjs        (`npm test` runs it, so `npm run verify` does; scripts/smoke.cjs holds it there)
//
// `node scripts/ios.configure.mjs --check` passing on the committed project says the project is right today; this says
// the check would see it go wrong, and that the iPhone check on the Mac says what it should when a runner misbehaves.
// Nothing here needs a Mac:
//
//   1. THE PROJECT. A copy of ios/ and the script is made in a folder of its own, one fault is put in it at a time — the
//      ones that would put the app back on one device, keep an iPad upright, or show an iPad a launch screen or an icon
//      it cannot use — and --check must fail, naming it. What the script writes, its writer puts back; what
//      scripts/ios.assets.mjs makes (the icon, the launch image), it names and leaves alone.
//   2. THE DEVICE'S NAME. lib/ios appleDeviceFrom: an iPad says iPad — in mobile mode, and as a Mac with a touch screen.
//   3. THE SIMULATOR STEP. .github/workflows/ios.yml's "Launch it on an iPhone, then an iPad" script, run as it is
//      written, with `xcrun simctl` stood in for (a device that never finishes booting, one that does on its second
//      boot, a bootstatus that hangs, an install the system refuses, an app that never lets its launch screen go…) and
//      every wait a thousandth as long. Runs #76, #78 and #79 failed on a stuck first boot and were put down to the app;
//      here a stuck boot is erased once, booted again, and named the runner's.
//   4. THE BUILT APP'S CHECK. The workflow's "The app is built for the iPhone and the iPad", run as written on an
//      Info.plist as Xcode writes one into the app: a universal build passes, and one built for the iPhone alone, or
//      asking an iPad for its whole screen, is refused by name.
import { cpSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { libLoader } from "./fixtures/chargeonce.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
// Never under /tmp/gt3-*: that name is the worktrees'.
const SANDBOX = mkdtempSync(join(tmpdir(), "ipad-check-"));

try {
  // ── 1 · the project ───────────────────────────────────────────────────────────────────────────
  const PBX = "ios/App/App.xcodeproj/project.pbxproj", INFO = "ios/App/App/Info.plist", VC = "ios/App/App/GT3ViewController.swift";
  const ICONS = "ios/App/App/Assets.xcassets/AppIcon.appiconset", SPLASH = "ios/App/App/Assets.xcassets/Splash.imageset", LAUNCH = "ios/App/App/Base.lproj/LaunchScreen.storyboard";
  let copies = 0;
  /** What ios.configure reads and writes, copied — never the build, the pods or the web pages `cap sync` puts in. */
  const project = () => {
    const dir = join(SANDBOX, `project-${++copies}`);
    cpSync(join(ROOT, "ios"), join(dir, "ios"), { recursive: true, filter: (src) => !/[\\/](build|Pods|public|output|DerivedData|xcuserdata)$/.test(src) });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    cpSync(join(ROOT, "scripts", "ios.configure.mjs"), join(dir, "scripts", "ios.configure.mjs"));
    mkdirSync(join(dir, "native", "ios"), { recursive: true });
    cpSync(join(ROOT, "native", "ios", "GT3Device.swift"), join(dir, "native", "ios", "GT3Device.swift"));
    symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "junction");
    return dir;
  };
  // The script, as a person runs it: its exit code and everything it said. Each fault below is its own copy, so they run at once.
  const run = (dir, ...args) => new Promise((resolve) => {
    const child = spawn(process.execPath, [join(dir, "scripts", "ios.configure.mjs"), ...args]);
    let said = "";
    child.stdout.on("data", (d) => { said += d; });
    child.stderr.on("data", (d) => { said += d; });
    child.on("close", (code) => resolve({ code, said }));
  });
  const text = (dir, f) => readFileSync(join(dir, f), "utf8");
  const edit = (dir, f, fn) => writeFileSync(join(dir, f), fn(text(dir, f)));
  const bytes = (dir, f, fn) => { const b = readFileSync(join(dir, f)); fn(b); writeFileSync(join(dir, f), b); };
  const ipadTurns = (t) => /<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>\s*<string>UIInterfaceOrientationPortrait<\/string>\s*<string>UIInterfaceOrientationPortraitUpsideDown<\/string>\s*<string>UIInterfaceOrientationLandscapeLeft<\/string>\s*<string>UIInterfaceOrientationLandscapeRight<\/string>\s*<\/array>/.test(t);
  const phoneTurns = (t) => /<key>UISupportedInterfaceOrientations<\/key>\s*<array>\s*<string>UIInterfaceOrientationPortrait<\/string>\s*<\/array>/.test(t);

  const pristine = (async () => {
    const r = await run(project(), "--check");
    ok("project: the copy of the committed project passes --check, as the project itself does", r.code === 0 && /says all of this/.test(r.said), r.said);
  })();

  // What the script writes: --check names it, and the writer puts it back.
  const WRITTEN = [
    { what: "the app back on the iPhone alone (TARGETED_DEVICE_FAMILY = 1)", file: PBX,
      fault: (t) => t.replace(/TARGETED_DEVICE_FAMILY = "1,2";/g, "TARGETED_DEVICE_FAMILY = 1;"), named: /project\.pbxproj/,
      back: (dir) => (text(dir, PBX).match(/TARGETED_DEVICE_FAMILY = "1,2";/g) || []).length === 2 && !/TARGETED_DEVICE_FAMILY = 1;/.test(text(dir, PBX)) },
    { what: "an iPad with no ways up of its own (no UISupportedInterfaceOrientations~ipad)", file: INFO,
      fault: (t) => t.replace(/\s*<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>[\s\S]*?<\/array>/, ""), named: /Info\.plist/,
      back: (dir) => ipadTurns(text(dir, INFO)) },
    { what: "an iPad that refuses to share its screen (UIRequiresFullScreen)", file: INFO,
      fault: (t) => t.replace(/(\n\s*<\/dict>\s*<\/plist>\s*)$/, "\n    <key>UIRequiresFullScreen</key>\n    <true/>$1"), named: /Info\.plist/,
      back: (dir) => !/UIRequiresFullScreen/.test(text(dir, INFO)) && ipadTurns(text(dir, INFO)) },
    { what: "an iPhone turned on its side (landscape in the iPhone's own list)", file: INFO,
      fault: (t) => t.replace(/(<key>UISupportedInterfaceOrientations<\/key>\s*<array>\s*<string>UIInterfaceOrientationPortrait<\/string>)/, "$1\n      <string>UIInterfaceOrientationLandscapeLeft</string>"), named: /Info\.plist/,
      back: (dir) => phoneTurns(text(dir, INFO)) },
    { what: "a view controller that leaves the iPad's ways up to Capacitor", file: VC,
      fault: (t) => t.replace(/\n\n    \/\/\/ WHICH WAYS UP[\s\S]*?\n    \}\n/, "\n"), named: /GT3ViewController\.swift/,
      back: (dir) => /override var supportedInterfaceOrientations: UIInterfaceOrientationMask \{\s*return UIDevice\.current\.userInterfaceIdiom == \.pad \? \.all : \.portrait\s*\}/.test(text(dir, VC)) },
  ];
  const written = WRITTEN.map(async (w) => {
    const dir = project();
    const before = text(dir, w.file);
    edit(dir, w.file, w.fault);
    ok(`project: the fault is made — ${w.what}`, text(dir, w.file) !== before);
    const checked = await run(dir, "--check");
    ok(`project: --check refuses ${w.what}, and names the file`, checked.code === 1 && w.named.test(checked.said), checked.said);
    const wrote = await run(dir);
    const again = await run(dir, "--check");
    ok(`project: the writer puts it back — ${w.what}`, wrote.code === 0 && again.code === 0 && w.back(dir), { wrote: wrote.said, again: again.said });
  });

  // What scripts/ios.assets.mjs makes: --check names it, and the writer refuses to pass it without touching it.
  const MADE = [
    { what: "an icon set of fixed sizes, which Xcode would not size for an iPad", file: `${ICONS}/Contents.json`, named: /not Xcode's single size/,
      fault: (dir) => edit(dir, `${ICONS}/Contents.json`, () => JSON.stringify({ images: [{ filename: "AppIcon-512@2x.png", idiom: "iphone", scale: "3x", size: "60x60" }], info: { author: "xcode", version: 1 } }, null, 2)) },
    { what: "an icon master with an alpha channel", file: `${ICONS}/AppIcon-512@2x.png`, named: /without alpha/,
      fault: (dir) => bytes(dir, `${ICONS}/AppIcon-512@2x.png`, (b) => { b[25] = 6; }) },
    { what: "an icon master of the wrong size (512 px)", file: `${ICONS}/AppIcon-512@2x.png`, named: /1024 × 1024 RGB/,
      fault: (dir) => bytes(dir, `${ICONS}/AppIcon-512@2x.png`, (b) => { b.writeUInt32BE(512, 16); b.writeUInt32BE(512, 20); }) },
    { what: "a launch screen drawn for one screen's size (its image centred, not filling)", file: LAUNCH, named: /launch screen/,
      fault: (dir) => edit(dir, LAUNCH, (t) => t.replace('contentMode="scaleAspectFill"', 'contentMode="center"')) },
    { what: "a launch screen pinned by constraints", file: LAUNCH, named: /launch screen/,
      fault: (dir) => edit(dir, LAUNCH, (t) => t.replace("</imageView>", '    <constraints><constraint firstAttribute="width" constant="375" id="w1"/></constraints>\n                    </imageView>')) },
    { what: "a launch image too small for an iPad's longer side (1,024 px)", file: `${SPLASH}/splash-2732x2732-1.png`, named: /launch image/,
      fault: (dir) => bytes(dir, `${SPLASH}/splash-2732x2732-1.png`, (b) => { b.writeUInt32BE(1024, 16); b.writeUInt32BE(1024, 20); }) },
  ];
  const made = MADE.map(async (m) => {
    const dir = project();
    m.fault(dir);
    const after = readFileSync(join(dir, m.file));
    const checked = await run(dir, "--check");
    ok(`assets: --check refuses ${m.what}, and says scripts/ios.assets.mjs made it`, checked.code === 1 && m.named.test(checked.said) && /scripts\/ios\.assets\.mjs/.test(checked.said), checked.said);
    const wrote = await run(dir);
    ok(`assets: the writer will not pass ${m.what}, and leaves the file as it found it`, wrote.code === 1 && m.named.test(wrote.said) && readFileSync(join(dir, m.file)).equals(after), wrote.said);
  });

  const template = (async () => {
    const dir = project();
    edit(dir, PBX, (t) => t.replace(/\t\t\t\tTARGETED_DEVICE_FAMILY = [^;]*;\n/g, ""));
    const r = await run(dir, "--check");
    ok("project: a template that stops setting TARGETED_DEVICE_FAMILY stops the script, by name", r.code !== 0 && /no longer sets TARGETED_DEVICE_FAMILY/.test(r.said), r.said);
  })();
  // Awaited at the end: these copies are checked while the simulator step's scenarios below are run, which mostly wait.
  const projectChecks = Promise.all([pristine, ...written, ...made, template]);

  // ── 2 · the device's name ─────────────────────────────────────────────────────────────────────
  {
    const IOS = libLoader()("lib/ios.ts");
    const IPAD = "Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
    const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
    const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
    ok("device: an iPad's own web view is an iPad", IOS.appleDeviceFrom(IPAD, 5, "iPad") === "iPad");
    ok("device: an iPad in iPadOS's desktop mode — a Mac with a touch screen — is an iPad", IOS.appleDeviceFrom(MAC, 5, "MacIntel") === "iPad");
    ok("device: an iPhone is an iPhone", IOS.appleDeviceFrom(IPHONE, 5, "iPhone") === "iPhone");
    ok("device: with nothing to ask (a server render), it is the iPhone it always said", typeof IOS.appleDevice === "function" && ["iPhone", "iPad"].includes(IOS.appleDevice()));
  }

  // ── 3 · the simulator step ────────────────────────────────────────────────────────────────────
  /** A block scalar's lines (`run: |`) under the step of this name, as the runner hands them to bash. */
  const stepScript = (yml, name) => {
    const lines = yml.split("\n");
    const at = lines.findIndex((l) => l.trim() === `- name: ${name}`);
    if (at < 0) return null;
    const runAt = lines.findIndex((l, i) => i > at && /^\s*run: \|\s*$/.test(l));
    if (runAt < 0) return null;
    const key = lines[runAt].search(/\S/);
    const body = [];
    for (let i = runAt + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() && l.search(/\S/) <= key) break;
      body.push(l);
    }
    const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
    return body.map((l) => l.slice(indent)).join("\n").replace(/\s+$/, "") + "\n";
  };
  const STEP = stepScript(readFileSync(join(ROOT, ".github", "workflows", "ios.yml"), "utf8"), "Launch it on an iPhone, then an iPad, and read what each says");
  ok("sim: the step is found in .github/workflows/ios.yml, as bash will be given it", !!STEP && /^set -euo pipefail\n/.test(STEP), STEP?.slice(0, 80));
  const bashOk = STEP ? spawnSync("bash", ["-n"], { input: STEP, encoding: "utf8" }) : { status: 1, stderr: "no step" };
  ok("sim: the step is bash that parses", bashOk.status === 0, bashOk.stderr);

  // The stand-in: `xcrun simctl`, each device's boot, install and app run as the scenario says (SIM_IPHONE_* and
  // SIM_IPAD_*: BOOT ok | stuck | stuck-once | hang, INSTALL ok | busy | bad, APP ok | nosplash | jserror | crash), and
  // every call written down. `sleep` waits a thousandth as long — except the step's two long waits, which keep enough to
  // mean the same on a machine busy with other work: the 25 s it gives the app (2 s here — a stand-in launched in the
  // background must have started by then) and the bound it puts on bootstatus (3 s — a stand-in bootstatus must be done
  // by then); and a hang, a thousand seconds and more, lasts twenty, outliving the bound.
  const BIN = join(SANDBOX, "bin");
  mkdirSync(BIN, { recursive: true });
  const realSleep = execFileSync("bash", ["-c", "command -v sleep"], { encoding: "utf8" }).trim();
  // (In awk's printf a bare > is a redirection, so the choice is in brackets.)
  writeFileSync(join(BIN, "sleep"), `#!/bin/sh\nexec ${realSleep} "$(awk -v s="$1" 'BEGIN { printf "%.3f", (s >= 1000 ? 20 : (s >= 100 ? 3 : (s >= 25 ? 2 : s / 1000))) }')"\n`);
  writeFileSync(join(BIN, "xcrun"), String.raw`#!/usr/bin/env bash
set -u
[ "$1" = simctl ] || { echo "xcrun stand-in: only simctl" >&2; exit 64; }
shift; cmd=$1; shift
echo "$cmd $*" >> "$SIM/calls.log"
kind() { case "$1" in IPAD*) echo IPAD ;; *) echo IPHONE ;; esac; }
get() { cat "$SIM/$1" 2>/dev/null || echo 0; }
put() { echo "$2" > "$SIM/$1"; }
mode() { local v="SIM_$(kind "$1")_$2"; echo "${"$"}{!v:-ok}"; }
stuck() {
  case "$(mode "$1" BOOT)" in
    stuck) return 0 ;;
    stuck-once) [ "$(get "$1.boots")" -le 1 ] ;;
    *) return 1 ;;
  esac
}
usable() { [ "$(get "$1.booted")" = 1 ] && ! stuck "$1"; }
boot_it() { if [ "$(get "$1.booted")" != 1 ]; then put "$1.booted" 1; put "$1.boots" $(( $(get "$1.boots") + 1 )); fi; }
case "$cmd" in
  list)
    pads=', {"name": "iPad (A16)", "udid": "IPAD-A16"}, {"name": "iPad Air 11-inch (M3)", "udid": "IPAD-AIR"}'
    [ "${"$"}{SIM_NO_IPAD:-0}" = 1 ] && pads=''
    echo '{"devices": {"com.apple.CoreSimulator.SimRuntime.watchOS-26-0": [{"name": "iPhone Watch", "udid": "WATCH"}], "com.apple.CoreSimulator.SimRuntime.iOS-26-0": [{"name": "iPhone 17 Pro", "udid": "IPHONE-PRO"}, {"name": "iPhone 17", "udid": "IPHONE-17"}'"$pads"']}}' ;;
  bootstatus)
    boot_it "$1"
    if [ "$(mode "$1" BOOT)" = hang ] && [ "$(get "$1.boots")" -le 1 ]; then exec sleep 5000; fi
    if stuck "$1"; then printf 'Monitoring boot status for %s.\n[Booting] Waiting on Data Migration … LaunchServicesMigrator\nStatus=4294967295\n' "$1"; exit 0; fi
    echo "Device already booted, nothing to do." ;;
  boot) boot_it "$1" ;;
  shutdown) put "$1.booted" 0; rm -f "$SIM/$1.run."* ;;
  erase) put "$1.erased" $(( $(get "$1.erased") + 1 )) ;;
  install)
    usable "$1" || { echo 'Unable to Install “GT3PB”' >&2; exit 1; }
    case "$(mode "$1" INSTALL)" in
      busy) printf 'An error was encountered processing the command (domain=IXUserPresentableErrorDomain, code=1):\nUnable to Install “GT3PB”\nPlease try again later.\n' >&2; exit 1 ;;
      bad) printf 'An error was encountered processing the command (domain=MIInstallerErrorDomain, code=13):\nFailed to get bundle ID from App.app/Info.plist\n' >&2; exit 1 ;;
    esac
    put "$1.installed" 1 ;;
  launch)
    [ "$1" = --console-pty ] && shift
    [ "$1" = --terminate-running-process ] && shift
    udid=$1; bundle=$2
    usable "$udid" || { echo "Unable to lookup in current state: Booting" >&2; exit 1; }
    if [ "$bundle" = com.apple.Preferences ]; then touch "$SIM/$udid.run.$bundle"; exit 0; fi
    [ "$(get "$udid.installed")" = 1 ] || { echo "The app is not installed" >&2; exit 1; }
    app=$(mode "$udid" APP)
    echo "⚡️  Loading app at capacitor://localhost..."
    [ "$app" = crash ] && exit 0
    touch "$SIM/$udid.run.$bundle"
    echo "⚡️  WebView loaded"
    [ "$app" = nosplash ] || echo "⚡️  To Native ->  SplashScreen hide 115273004"
    echo "⚡️  To Native ->  SystemBars setStyle 115273005"
    [ "$app" = jserror ] && echo '⚡️  [error] - {"message":"TypeError: undefined is not an object"}'
    exit 0 ;;
  spawn)
    [ "$(get "$1.booted")" = 1 ] || exit 1
    for f in "$SIM/$1.run."*; do [ -e "$f" ] && printf -- '-\t0\tUIKitApplication:%s[1a2b][rb-legacy]\n' "${"$"}{f##*.run.}"; done; exit 0 ;;
  terminate) rm -f "$SIM/$1.run.$2" ;;
  io) touch "$3" ;;
  *) echo "xcrun stand-in: no $cmd" >&2; exit 64 ;;
esac
`);
  chmodSync(join(BIN, "sleep"), 0o755);
  chmodSync(join(BIN, "xcrun"), 0o755);

  const SCENARIOS = [
    { id: "healthy", what: "a runner that boots both: the app runs on each, and nothing is said against it", env: {} },
    { id: "stuck", what: "an iPhone that never finishes booting", env: { SIM_IPHONE_BOOT: "stuck" } },
    { id: "once", what: "an iPhone stuck on its first boot that comes up on its second", env: { SIM_IPHONE_BOOT: "stuck-once" } },
    { id: "hang", what: "a bootstatus that never returns, on a device that is up", env: { SIM_IPHONE_BOOT: "hang" } },
    { id: "busy", what: "an install the iPhone's system refuses (\"Unable to Install … Please try again later\")", env: { SIM_IPHONE_INSTALL: "busy" } },
    { id: "bad", what: "an install refused for the app's own bundle", env: { SIM_IPHONE_INSTALL: "bad" } },
    { id: "nosplash", what: "an app that never lets its launch screen go", env: { SIM_IPHONE_APP: "nosplash" } },
    { id: "padstuck", what: "an iPad that never finishes booting", env: { SIM_IPAD_BOOT: "stuck" } },
    { id: "paderror", what: "an app that logs an error on the iPad", env: { SIM_IPAD_APP: "jserror" } },
    { id: "padcrash", what: "an app that is not running on the iPad", env: { SIM_IPAD_APP: "crash" } },
    { id: "nopad", what: "a runner with no iPad", env: { SIM_NO_IPAD: "1" } },
    { id: "slow", what: "a runner whose iPhone took fifteen minutes", env: {}, before: "SECONDS=1000\n" },
  ];
  const results = STEP && bashOk.status === 0 ? await Promise.all(SCENARIOS.map((s) => new Promise((resolve) => {
    const work = join(SANDBOX, `sim-${s.id}`), state = join(work, ".sim");
    mkdirSync(state, { recursive: true });
    writeFileSync(join(work, "step.sh"), (s.before ?? "") + STEP);
    // As the runner runs a step: bash --noprofile --norc -eo pipefail {0}.
    const child = spawn("bash", ["--noprofile", "--norc", "-eo", "pipefail", "step.sh"], { cwd: work, env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, SIM: state, ...s.env } });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const stop = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.on("close", (code) => {
      clearTimeout(stop);
      let calls = [];
      try { calls = readFileSync(join(state, "calls.log"), "utf8").trim().split("\n").filter(Boolean); } catch { /* no calls */ }
      resolve([s.id, { code, out, calls }]);
    });
  }))) : [];
  const R = Object.fromEntries(results);
  const said = (id, re) => re.test(R[id]?.out ?? "");
  const calls = (id, re) => (R[id]?.calls ?? []).filter((c) => re.test(c));
  const order = (id, re) => (R[id]?.calls ?? []).findIndex((c) => re.test(c));
  const seen = (id) => ({ code: R[id]?.code, out: (R[id]?.out ?? "").split("\n").filter((l) => /::(error|warning|notice)::/.test(l)), calls: R[id]?.calls?.length });
  const blamed = (id) => said(id, /crashed\?|never let the launch screen go|never started loading|logged an error/);

  ok(`sim: ${SCENARIOS[0].what}`, R.healthy?.code === 0 && !said("healthy", /::(error|warning)::/)
    && calls("healthy", /^install IPHONE-17 /).length === 1 && calls("healthy", /^install IPAD-AIR /).length === 1
    && calls("healthy", /^launch --console-pty --terminate-running-process IPAD-AIR com\.gt3pb\.app$/).length === 1
    && calls("healthy", /^erase /).length === 0 && order("healthy", /^shutdown IPHONE-17$/) < order("healthy", /^bootstatus IPAD-AIR /), seen("healthy"));
  ok("sim: the iPhone is the iPhone 17 and the iPad the 11-inch iPad Air when the runner has them — never the watch's runtime",
    calls("healthy", /IPHONE-PRO|IPAD-A16|WATCH/).length === 0, R.healthy?.calls);
  ok(`sim: ${SCENARIOS[1].what} is restarted, erased once before its last try, and named the runner's after three — the app is never installed on it, nor blamed`,
    R.stuck?.code === 1 && said("stuck", /::error::the runner's iPhone simulator never finished booting, three times — a runner problem, not the app: re-run the job/)
      && calls("stuck", /^bootstatus IPHONE-17 /).length === 3 && calls("stuck", /^erase IPHONE-17$/).length === 1
      && order("stuck", /^erase IPHONE-17$/) > order("stuck", /^shutdown IPHONE-17$/) && calls("stuck", /^install /).length === 0 && !blamed("stuck")
      && said("stuck", /Waiting on Data Migration … LaunchServicesMigrator/) && said("stuck", /could not run Apple's own Settings \(try 2 of 3\)/),
    seen("stuck"));
  {
    const c = R.stuck?.calls ?? [];
    const boots = c.map((x, i) => (/^bootstatus IPHONE-17 /.test(x) ? i : -1)).filter((i) => i >= 0), erase = c.findIndex((x) => /^erase IPHONE-17$/.test(x));
    ok("sim: the erase comes between the second try and the third — never before the restart has had its go", boots.length === 3 && erase > boots[1] && erase < boots[2], { boots, erase });
  }
  ok(`sim: ${SCENARIOS[2].what} passes — restarted once, never erased`,
    R.once?.code === 0 && said("once", /::warning::the iPhone simulator could not run Apple's own Settings \(try 1 of 3\)/) && calls("once", /^erase /).length === 0
      && order("once", /^install IPHONE-17 /) > calls("once", /^bootstatus IPHONE-17 /).length - 1, seen("once"));
  ok(`sim: ${SCENARIOS[3].what} is stopped at its bound, and Apple's Settings opening counts the device as booted`,
    R.hang?.code === 0 && said("hang", /::notice::bootstatus gave up, but Apple's Settings opened on the device — booted/) && calls("hang", /^erase /).length === 0, seen("hang"));
  ok(`sim: ${SCENARIOS[4].what} is the runner's, not the app's — and the iPad is not started on a runner like that`,
    R.busy?.code === 1 && said("busy", /::error::the runner's iPhone simulator would not take the app — its system was not ready \(simctl's words above\): a runner problem, not the app — re-run the job/)
      && calls("busy", /^install IPHONE-17 /).length === 2 && !blamed("busy") && calls("busy", /IPAD/).length === 0, seen("busy"));
  ok(`sim: ${SCENARIOS[5].what} is the app's — simctl's words are shown, and the iPad waits for a run the iPhone passes`,
    R.bad?.code === 1 && said("bad", /::error::the iPhone simulator would not install the app on its last go/) && said("bad", /Failed to get bundle ID from App\.app\/Info\.plist/)
      && !said("bad", /a runner problem/) && said("bad", /::notice::the iPad waits for a run the iPhone passes/) && calls("bad", /IPAD/).length === 0, seen("bad"));
  ok(`sim: ${SCENARIOS[6].what} fails the run, in the app's name`,
    R.nosplash?.code === 1 && said("nosplash", /::error::on the iPhone, the page never let the launch screen go/) && !said("nosplash", /a runner problem/), seen("nosplash"));
  ok(`sim: ${SCENARIOS[7].what} is erased once, then left unchecked with a warning — the iPhone already ran the app, so the run passes`,
    R.padstuck?.code === 0 && said("padstuck", /::warning::the runner's iPad simulator never finished booting, twice — a runner problem, not the app; the iPad went unchecked this run/)
      && calls("padstuck", /^erase IPAD-AIR$/).length === 1 && calls("padstuck", /^install IPAD-AIR /).length === 0 && !said("padstuck", /::error::/), seen("padstuck"));
  ok(`sim: ${SCENARIOS[8].what} fails the run, in the app's name`, R.paderror?.code === 1 && said("paderror", /::error::on the iPad, the page logged an error/), seen("paderror"));
  ok(`sim: ${SCENARIOS[9].what} fails the run — "crashed?", after one more go on a restarted iPad`,
    R.padcrash?.code === 1 && said("padcrash", /::error::the app is not running on the iPad 25 s after launch \(crashed\?\)/) && calls("padcrash", /^install IPAD-AIR /).length === 2, seen("padcrash"));
  ok(`sim: ${SCENARIOS[10].what} passes with a warning that the iPad went unchecked`,
    R.nopad?.code === 0 && said("nopad", /::warning::no iPad simulator on this runner — the iPad went unchecked this run/), seen("nopad"));
  ok(`sim: ${SCENARIOS[11].what} leaves the iPad for another run, and says so`,
    R.slow?.code === 0 && said("slow", /::warning::the iPhone took \d+ minutes to boot and run — the runner is slow today, and the iPad went unchecked this run/) && calls("slow", /IPAD/).length === 0, seen("slow"));
  ok("sim: every run keeps its first screen and its logs where the upload step looks",
    ["first-screen.png", "app.log", "boot.log"].every((f) => { try { readFileSync(join(SANDBOX, "sim-healthy", f)); return true; } catch { return false; } })
      && ["ipad-first-screen.png", "ipad-app.log", "ipad-boot.log"].every((f) => { try { readFileSync(join(SANDBOX, "sim-healthy", f)); return true; } catch { return false; } }));

  // ── 4 · the built app's check ─────────────────────────────────────────────────────────────────
  // "The app is built for the iPhone and the iPad", run as it is written on an Info.plist as Xcode writes one into a
  // built app: the project's own keys, and what the build adds — UIDeviceFamily from TARGETED_DEVICE_FAMILY, and each
  // device's icon from the asset catalog. A universal build passes; one built for the iPhone alone, or asking an iPad for
  // its whole screen, is refused by name.
  const BUILT = stepScript(readFileSync(join(ROOT, ".github", "workflows", "ios.yml"), "utf8"), "The app is built for the iPhone and the iPad");
  ok("built: the step is found in .github/workflows/ios.yml", !!BUILT && /^python3 - ios\/App\/build\/Build\/Products\/Debug-iphonesimulator\/App\.app\/Info\.plist <<'PY'\n/.test(BUILT), BUILT?.slice(0, 80));
  // The built Info.plist is written by Python's plistlib — the reader the step itself uses — from the committed one, in
  // binary as Xcode leaves it in an app: the project's keys, and what the build adds for each kind of build.
  const MAKE = String.raw`
import plistlib, sys
src, out, kind = sys.argv[1], sys.argv[2], sys.argv[3]
info = plistlib.load(open(src, "rb"))
icon = lambda files: {"CFBundlePrimaryIcon": {"CFBundleIconFiles": files, "CFBundleIconName": "AppIcon"}}
info["CFBundleIcons"] = icon(["AppIcon60x60"])
if kind == "iphone":
    info["UIDeviceFamily"] = [1]
    info.pop("UISupportedInterfaceOrientations~ipad", None)
else:
    info["UIDeviceFamily"] = [1, 2]
    info["CFBundleIcons~ipad"] = icon(["AppIcon60x60", "AppIcon76x76"])
if kind == "full":
    info["UIRequiresFullScreen"] = True
plistlib.dump(info, open(out, "wb"), fmt=plistlib.FMT_BINARY)
`;
  const BUILDS = [
    { id: "universal", what: "a universal build passes", code: 0, says: /^(?!.*MISSING)/s },
    { id: "iphone", what: "a build for the iPhone alone is refused — its family, the iPad's ways up and the iPad's icon, each named", code: 1,
      says: /MISSING\s+it installs on an iPhone and an iPad[\s\S]*MISSING\s+an iPad turns all four ways[\s\S]*MISSING\s+the iPad's icon, made from the master[\s\S]*::error::the built app is not what an iPad needs/ },
    { id: "full", what: "a build that asks an iPad for its whole screen is refused", code: 1, says: /MISSING\s+it shares an iPad's screen \(no UIRequiresFullScreen\)/ },
  ];
  const built = BUILT ? await Promise.all(BUILDS.map((b) => new Promise((resolve) => {
    const work = join(SANDBOX, `built-${b.id}`), appDir = join(work, "ios/App/build/Build/Products/Debug-iphonesimulator/App.app");
    mkdirSync(appDir, { recursive: true });
    const made = spawnSync("python3", ["-c", MAKE, join(ROOT, INFO), join(appDir, "Info.plist"), b.id], { encoding: "utf8" });
    if (made.status !== 0) { resolve({ ...b, got: null, out: `could not write the built Info.plist: ${made.stderr}` }); return; }
    writeFileSync(join(work, "step.sh"), BUILT);
    const child = spawn("bash", ["--noprofile", "--norc", "-eo", "pipefail", "step.sh"], { cwd: work });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (code) => resolve({ ...b, got: code, out }));
  }))) : [];
  for (const b of built) ok(`built: ${b.what}`, b.got === b.code && b.says.test(b.out), { code: b.got, out: b.out });
  await projectChecks;
} finally {
  rmSync(SANDBOX, { recursive: true, force: true });
}

console.log(`THE IOS PROJECT AND THE IPHONE CHECK: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
