// THE IPHONE PROJECT, SET UP THE GT3 WAY (2026-10-06, the iPhone round).
//
//   node scripts/ios.configure.mjs           (after `npx cap add ios`, or any time — it changes only what is off)
//   node scripts/ios.configure.mjs --check   (changes nothing; exits 1 if the committed project differs —
//                                             scripts/smoke.cjs runs this, so ios/ cannot drift from here)
//
// ios/ is committed, and this is how it came to differ from Capacitor's template — written as a
// script, not as hand edits, so a regenerated project is put back the same way and scripts/smoke.cjs
// can hold the committed one to it. Each step says why:
//
//   1. GT3ViewController (App/GT3ViewController.swift) — the app is a Next.js static export, a page per
//      screen, and Capacitor's file server answers every extensionless address with the root page; its
//      router finds the page the export made (crew.html), so a reload shows the screen you were on.
//      SceneDelegate and Main.storyboard both start it.
//   2. Info.plist — what Apple requires the app to say: why it may use the camera, the microphone,
//      photos, speech and location (the screens already ask for each; a missing reason is a crash), that
//      its only encryption is HTTPS, that it is portrait, and that it is an iPhone app.
//   3. PrivacyInfo.xcprivacy — the privacy manifest Apple has required since May 2024: no tracking, the
//      data the app collects and why, and no "required reason" APIs of its own (Capacitor ships its own
//      manifest inside its framework).
//   4. iPhone only (TARGETED_DEVICE_FAMILY 1) — the screens are designed for a phone; an iPad runs the
//      iPhone app as it is, and no iPad screenshots are owed to the store.
//   5. A shared scheme (App.xcodeproj/xcshareddata/xcschemes/App.xcscheme) — what xcodebuild builds,
//      runs and archives by name on a machine that has never opened the project in Xcode: CI's Mac.
//   6. GT3Device (App/GT3Device.swift, copied from native/ios/GT3Device.swift — edit it there) — the
//      app's own plugin: what the phone does for a page that the web view cannot (save a file to the
//      share sheet, print, add an event to the calendar, a pass to Wallet; lib/deviceActions is its
//      page side). GT3ViewController registers it, and Info.plist says why it may save to Photos (the
//      share sheet's Save Image) and, on iOS 15 and 16, use the calendar.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const plist = require("plist");

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const APP = join(ROOT, "ios", "App", "App");
const PBX = join(ROOT, "ios", "App", "App.xcodeproj", "project.pbxproj");
if (!existsSync(PBX)) { console.log("ios.configure — no ios/ project; run `npx cap add ios` first."); process.exit(1); }
const CHECK = process.argv.includes("--check");
const changed = [];
// Every change goes through here, so --check can say what it would do and do none of it.
const stage = (path, text, label) => { if (!existsSync(path) || readFileSync(path, "utf8") !== text) { if (!CHECK) writeFileSync(path, text); changed.push(label); } };
const put = (file, text) => stage(join(APP, file), text, file);

// ── 1 · the view controller ──────────────────────────────────────────────────────────────────────
put("GT3ViewController.swift", `import UIKit
import Capacitor

/// THE GT3 APP'S VIEW CONTROLLER (2026-10-06, the iPhone round; scripts/ios.configure.mjs writes it).
///
/// Capacitor's file server answers any address without a file extension with the root index.html —
/// right for a one-page app, wrong for this one: the app is a Next.js static export, a page per screen
/// (crew.html, menu.html, primal/lesson.html). A reload, an error screen's "Try again", or a link that
/// loads a page whole would show the home page instead of the screen asked for. ExportRouter finds the
/// page the export made for the address and falls back to the root only when there is none.
final class GT3ViewController: CAPBridgeViewController {
    override func router() -> Router {
        return ExportRouter()
    }

    /// The app's own plugin (GT3Device.swift): what the phone does for a page — save a file, print, add
    /// an event to the calendar or a pass to Wallet. Capacitor finds the plugins it installs from
    /// node_modules by itself; one that lives in the app is registered here, before the first page loads.
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(GT3DevicePlugin())
    }
}

struct ExportRouter: Router {
    var basePath: String = ""

    func route(for path: String) -> String {
        if !URL(fileURLWithPath: path).pathExtension.isEmpty {
            return basePath + path
        }
        var page = path
        while page.hasSuffix("/") { page.removeLast() }
        if page.isEmpty {
            return basePath + "/index.html"
        }
        for candidate in [page + ".html", page + "/index.html"] where FileManager.default.fileExists(atPath: basePath + candidate) {
            return basePath + candidate
        }
        return basePath + "/index.html"
    }
}
`);

// The app's own plugin — one source, native/ios/GT3Device.swift, copied into the target here.
put("GT3Device.swift", readFileSync(join(ROOT, "native", "ios", "GT3Device.swift"), "utf8"));

const scene = join(APP, "SceneDelegate.swift");
const sceneText = readFileSync(scene, "utf8");
stage(scene, sceneText.replace("rootViewController = CAPBridgeViewController()", "rootViewController = GT3ViewController()"), "SceneDelegate.swift");
const board = join(APP, "Base.lproj", "Main.storyboard");
const boardText = readFileSync(board, "utf8");
stage(board, boardText.replace('customClass="CAPBridgeViewController" customModule="Capacitor"', 'customClass="GT3ViewController" customModule="App" customModuleProvider="target"'), "Base.lproj/Main.storyboard");

// The launch screen's own ground is the app's charcoal, not the system white, so no edge of it can
// flash white before the image fills it.
const launch = join(APP, "Base.lproj", "LaunchScreen.storyboard");
const launchText = readFileSync(launch, "utf8");
const WHITE = '<color key="backgroundColor" systemColor="systemBackgroundColor"/>';
stage(launch, launchText.replace(WHITE, '<color key="backgroundColor" red="0.0824" green="0.0784" blue="0.0588" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>'), "Base.lproj/LaunchScreen.storyboard");

// ── 2 · Info.plist ───────────────────────────────────────────────────────────────────────────────
const infoPath = join(APP, "Info.plist");
const info = plist.parse(readFileSync(infoPath, "utf8"));
const want = {
  CFBundleDisplayName: "GT3PB",
  // HTTPS only — exempt, and saying so skips the export-compliance question on every upload.
  ITSAppUsesNonExemptEncryption: false,
  // Every file picker that offers "Take Photo" (receipts, inspections, a profile photo, the studio).
  NSCameraUsageDescription: "GT3 uses the camera when you choose to take a photo — a receipt, an inspection, your profile picture or a post for the studio.",
  // "Take Video" in the studio records sound, and dictation listens.
  NSMicrophoneUsageDescription: "GT3 uses the microphone when you record a video for the studio or dictate a note.",
  NSSpeechRecognitionUsageDescription: "GT3 turns what you say into text when you dictate a note or a message.",
  NSPhotoLibraryUsageDescription: "GT3 opens your photos only to attach the one you choose.",
  // The share sheet's Save Image (a flyer, your status card, a post's photo): without this the app
  // crashes the moment someone taps it.
  NSPhotoLibraryAddUsageDescription: "GT3 saves an image to your photos only when you choose Save Image.",
  // Add to calendar on iOS 15 and 16, where the phone asks before the New Event sheet opens. From
  // iOS 17 the sheet needs no permission and this is never shown (native/ios/GT3Device.swift).
  NSCalendarsUsageDescription: "GT3 adds an event or a stop to your calendar only when you tap Add to calendar.",
  // Live Ops shares the truck's position with customers while the crew is running Live.
  NSLocationWhenInUseUsageDescription: "GT3 shares the truck's location with customers while you run Live, and only while the app is open.",
  UIViewControllerBasedStatusBarAppearance: true,
  // Light text over the launch screen's charcoal, before the app's own view controller sets it.
  UIStatusBarStyle: "UIStatusBarStyleLightContent",
  UISupportedInterfaceOrientations: ["UIInterfaceOrientationPortrait"],
  UIRequiredDeviceCapabilities: ["arm64"],
};
let infoChanged = false;
for (const [k, v] of Object.entries(want)) {
  if (JSON.stringify(info[k]) !== JSON.stringify(v)) { info[k] = v; infoChanged = true; }
}
if ("UISupportedInterfaceOrientations~ipad" in info) { delete info["UISupportedInterfaceOrientations~ipad"]; infoChanged = true; }
if (infoChanged) stage(infoPath, plist.build(info) + "\n", "Info.plist");

// ── 3 · the privacy manifest ─────────────────────────────────────────────────────────────────────
// What GT3 stores (supabase/schema.columns.json): names, emails and phones (customers), delivery
// addresses (delivery_orders), photos people upload, orders, the truck's live position from the crew's
// phone, notes and reviews people write, crash reports (client_errors), and an account id. Card
// numbers are typed into Square's form inside the app and never reach GT3. None of it tracks anyone.
const collected = (type, linked, purposes = ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]) => ({
  NSPrivacyCollectedDataType: type,
  NSPrivacyCollectedDataTypeLinked: linked,
  NSPrivacyCollectedDataTypeTracking: false,
  NSPrivacyCollectedDataTypePurposes: purposes,
});
const manifest = {
  NSPrivacyTracking: false,
  NSPrivacyTrackingDomains: [],
  NSPrivacyCollectedDataTypes: [
    collected("NSPrivacyCollectedDataTypeName", true),
    collected("NSPrivacyCollectedDataTypeEmailAddress", true),
    collected("NSPrivacyCollectedDataTypePhoneNumber", true),
    collected("NSPrivacyCollectedDataTypePhysicalAddress", true),
    collected("NSPrivacyCollectedDataTypeUserID", true),
    collected("NSPrivacyCollectedDataTypePurchaseHistory", true),
    collected("NSPrivacyCollectedDataTypePaymentInfo", true),
    collected("NSPrivacyCollectedDataTypePreciseLocation", true),
    collected("NSPrivacyCollectedDataTypePhotosorVideos", true),
    collected("NSPrivacyCollectedDataTypeOtherUserContent", true),
    collected("NSPrivacyCollectedDataTypeCrashData", false),
  ],
  NSPrivacyAccessedAPITypes: [],
};
put("PrivacyInfo.xcprivacy", plist.build(manifest) + "\n");

// ── 4 · the project file: the new files, iPhone only ───────────────────────────────────────────
// Written as Xcode itself writes these lines (compare SceneDelegate's), with ids made from the file's
// name, so running this again finds them and changes nothing.
const id = (s) => createHash("sha1").update(`gt3:${s}`).digest("hex").slice(0, 24).toUpperCase();
let pbx = readFileSync(PBX, "utf8");
const before = pbx;
const groupStart = pbx.indexOf("/* App */ = {\n\t\t\tisa = PBXGroup;");
if (groupStart < 0) throw new Error("ios.configure — the App group is not where the template puts it");
const addFile = (name, type, phase) => {
  if (pbx.includes(`/* ${name} */ = {isa = PBXFileReference;`)) return;
  const ref = id(`ref:${name}`), build = id(`build:${name}`);
  pbx = pbx.replace("/* End PBXBuildFile section */",
    `\t\t${build} /* ${name} in ${phase} */ = {isa = PBXBuildFile; fileRef = ${ref} /* ${name} */; };\n/* End PBXBuildFile section */`);
  pbx = pbx.replace("/* End PBXFileReference section */",
    `\t\t${ref} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = ${type}; path = ${name}; sourceTree = "<group>"; };\n/* End PBXFileReference section */`);
  const g = pbx.indexOf("/* App */ = {\n\t\t\tisa = PBXGroup;");
  const kids = pbx.indexOf("children = (\n", g) + "children = (\n".length;
  pbx = pbx.slice(0, kids) + `\t\t\t\t${ref} /* ${name} */,\n` + pbx.slice(kids);
  const ph = pbx.indexOf(`/* ${phase} */ = {\n\t\t\tisa = PBX${phase}BuildPhase;`);
  if (ph < 0) throw new Error(`ios.configure — no ${phase} build phase`);
  const files = pbx.indexOf("files = (\n", ph) + "files = (\n".length;
  pbx = pbx.slice(0, files) + `\t\t\t\t${build} /* ${name} in ${phase} */,\n` + pbx.slice(files);
};
addFile("GT3ViewController.swift", "sourcecode.swift", "Sources");
addFile("GT3Device.swift", "sourcecode.swift", "Sources");
addFile("PrivacyInfo.xcprivacy", "text.xml", "Resources");
pbx = pbx.replace(/TARGETED_DEVICE_FAMILY = "1,2";/g, 'TARGETED_DEVICE_FAMILY = 1;');
if (pbx !== before) stage(PBX, pbx, "App.xcodeproj/project.pbxproj");

// ── 5 · the shared scheme ───────────────────────────────────────────────────────────────────────
const target = /\t\t([0-9A-F]{24}) \/\* App \*\/ = \{\n\t\t\tisa = PBXNativeTarget;/.exec(pbx)?.[1];
if (!target) throw new Error("ios.configure — no App target in the project file");
const app = `<BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "${target}"
               BuildableName = "App.app"
               BlueprintName = "App"
               ReferencedContainer = "container:App.xcodeproj">
            </BuildableReference>`;
const SCHEMES = join(ROOT, "ios", "App", "App.xcodeproj", "xcshareddata", "xcschemes");
if (!CHECK) mkdirSync(SCHEMES, { recursive: true });
stage(join(SCHEMES, "App.xcscheme"), `<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "1600"
   version = "1.7">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "YES"
            buildForProfiling = "YES"
            buildForArchiving = "YES"
            buildForAnalyzing = "YES">
            ${app}
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      shouldUseLaunchSchemeArgsEnv = "YES"
      shouldAutocreateTestPlan = "YES">
   </TestAction>
   <LaunchAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      ignoresPersistentStateOnLaunch = "NO"
      debugDocumentVersioning = "YES"
      debugServiceExtension = "internal"
      allowLocationSimulation = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         ${app}
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction
      buildConfiguration = "Release"
      shouldUseLaunchSchemeArgsEnv = "YES"
      savedToolIdentifier = ""
      useCustomWorkingDirectory = "NO"
      debugDocumentVersioning = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         ${app}
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction
      buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction
      buildConfiguration = "Release"
      revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
`, "App.xcodeproj/xcshareddata/xcschemes/App.xcscheme");

if (CHECK) {
  console.log(changed.length ? `ios.configure --check — the committed project differs in: ${changed.join(", ")} (run node scripts/ios.configure.mjs and commit)` : "ios.configure --check — the committed project says all of this.");
  process.exit(changed.length ? 1 : 0);
}
console.log(changed.length ? `ios.configure — set: ${changed.join(", ")}` : "ios.configure — the project already says all of this.");
