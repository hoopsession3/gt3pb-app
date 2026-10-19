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
//      its only encryption is HTTPS, and which ways up it turns: an iPhone upright, an iPad any way up.
//   3. PrivacyInfo.xcprivacy — the privacy manifest Apple has required since May 2024: no tracking, the
//      data the app collects and why, and no "required reason" APIs of its own (Capacitor ships its own
//      manifest inside its framework).
//   4. iPhone and iPad (TARGETED_DEVICE_FAMILY "1,2"). THE APP RUNS ON AN IPAD (2026-10-11): until today it was
//      iPhone only, and an iPad ran it as an iPhone app blown up — a phone's screen in the middle of the glass,
//      upright only. Now it installs as itself: the iPad's own size, any way up, and beside another app (Split View,
//      Stage Manager, an iPadOS 26 window — the crew's POS on one side and the Pass on the other). So there is no
//      UIRequiresFullScreen: Apple deprecated it in iPadOS 26, and an app that shares the screen must turn all four
//      ways (UISupportedInterfaceOrientations~ipad). The screens pick their layout from the width the web view is
//      given — a phone's under 520 × 640, one column held upright, the desk on its side (lib/surfaces) — and
//      capacitor.config.ts keeps the web view in mobile mode, so an iPad is never handed a laptop's page. An iPhone
//      stays upright: on a phone the Pass is read in one column, and a phone on its side would leave about 330pt
//      under the tab bar and put the Dynamic Island at an edge no screen has been measured against. The App Store
//      asks for iPad screenshots from now on (13-inch).
//   5. A shared scheme (App.xcodeproj/xcshareddata/xcschemes/App.xcscheme) — what xcodebuild builds,
//      runs and archives by name on a machine that has never opened the project in Xcode: CI's Mac.
//   6. GT3Device (App/GT3Device.swift, copied from native/ios/GT3Device.swift — edit it there) — the
//      app's own plugin: what the phone does for a page that the web view cannot (save a file to the
//      share sheet, print, add an event to the calendar, a pass to Wallet; lib/deviceActions is its
//      page side). GT3ViewController registers it, and Info.plist says why it may save to Photos (the
//      share sheet's Save Image) and, on iOS 15 and 16, use the calendar.
//   7. Sign in with Apple (App/App.entitlements, 2026-10-11) — the one capability the app asks for: Apple's sheet
//      (GT3Device signInWithApple) refuses an app whose signature lacks com.apple.developer.applesignin. The App ID
//      has the capability (the Apple Developer account, com.gt3pb.app), the target names this file
//      (CODE_SIGN_ENTITLEMENTS), and the TestFlight job signs it into the archive before the export re-signs it
//      (.github/workflows/ios.yml), since the archive is built unsigned.
//   8. What the iPad shows before the page (2026-10-11): the app icon and the launch screen. scripts/ios.assets.mjs
//      draws both from the brand file and this does not write them, but the iPad depends on how they are made, so
//      they are held here (step 8, below): an icon set Xcode sizes for every device from one master, and a launch
//      image that fills any screen either way up.
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
// What this holds but cannot write (step 8): made by scripts/ios.assets.mjs, so a fault there is named, never patched.
const held = [];
// WHICH WAYS UP (2026-10-11, header 4): an iPhone held upright, an iPad any way up. Info.plist says it in these words;
// GT3ViewController says the same in Swift (.portrait, .all), and scripts/smoke.cjs holds the two together.
const IPHONE_TURNS = ["UIInterfaceOrientationPortrait"];
const IPAD_TURNS = ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationPortraitUpsideDown", "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"];
// Every change goes through here, so --check can say what it would do and do none of it.
const stage = (path, text, label) => { if (!existsSync(path) || readFileSync(path, "utf8") !== text) { if (!CHECK) writeFileSync(path, text); changed.push(label); } };
const put = (file, text) => stage(join(APP, file), text, file);

// ── 1 · the view controller ──────────────────────────────────────────────────────────────────────
put("GT3ViewController.swift", `import UIKit
import WebKit
import Capacitor

/// THE GT3 APP'S VIEW CONTROLLER (2026-10-06, the iPhone round; scripts/ios.configure.mjs writes it).
///
/// Capacitor's file server answers any address without a file extension with the root index.html —
/// right for a one-page app, wrong for this one: the app is a Next.js static export, a page per screen
/// (crew.html, menu.html, primal/lesson.html). A reload, an error screen's "Try again", or a link that
/// loads a page whole would show the home page instead of the screen asked for. ExportRouter finds the
/// page the export made for the address and falls back to the root only when there is none.
final class GT3ViewController: CAPBridgeViewController {
    /// What a pinch did to the page's size, watched so a zoomed-in page can be moved about (capacitorDidLoad, below).
    private var zoomWatch: NSKeyValueObservation?

    override func router() -> Router {
        return ExportRouter()
    }

    /// The app's own plugin (GT3Device.swift): what the phone does for a page — save a file, print, add
    /// an event to the calendar or a pass to Wallet. Capacitor finds the plugins it installs from
    /// node_modules by itself; one that lives in the app is registered here, before the first page loads.
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(GT3DevicePlugin())
        // MOVED ABOUT WHILE ZOOMED IN (2026-10-19, R36 — the fresh audit's UX11-07). At its own size the page never
        // scrolls as a whole: it scrolls inside its own column (capacitor.config.ts scrollEnabled: false), so a drag on
        // the header or the tab bar doesn't rubber-band the app. Pinched bigger, the page is larger than the screen and
        // the web view's own scroll view is what moves it under the finger — let move while it is zoomed in, and
        // stopped again at its own size.
        zoomWatch = webView?.scrollView.observe(\\.contentSize, options: [.new]) { scroll, _ in
            let zoomedIn = scroll.zoomScale > scroll.minimumZoomScale + 0.01
            if scroll.isScrollEnabled != zoomedIn { scroll.isScrollEnabled = zoomedIn }
        }
    }

    /// PINCH TO ZOOM (2026-10-19, R36 — the fresh audit's UX11-07; Ryan: "Allow pinch-zoom"). On an iPhone the page
    /// asks for maximum-scale=1 (lib/ios holdFocusZoom), so iOS doesn't zoom into a tapped field under 16px and stay
    /// there. Safari lets a person pinch past that limit anyway; a web view doesn't unless it is told to, so in the app
    /// someone who needed the page bigger than Text Size makes it couldn't have it. Told here: the limit stops the zoom
    /// into a field, never a person's pinch. (capacitor.config.ts zoomEnabled keeps Capacitor's own scroll delegate —
    /// which refuses every pinch — off the web view.)
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.ignoresViewportScaleLimits = true
        return configuration
    }

    /// WHICH WAYS UP (2026-10-11, the app runs on an iPad): an iPhone held upright, an iPad any way up — the two lists
    /// Info.plist keeps (UISupportedInterfaceOrientations, and the iPad's own ~ipad one). Capacitor answers this from
    /// the plain key alone (CAPBridgeViewController setScreenOrientationDefaults), so its answer would rest on iOS
    /// handing it the iPad's list under the iPhone's name; it is said here instead, for the device in hand.
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        return UIDevice.current.userInterfaceIdiom == .pad ? .all : .portrait
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
// ALERTS (2026-10-11): iOS hands the device token for notifications to the app delegate; Capacitor's push plugin
// hears it through these two notifications (its documented AppDelegate lines). Added once, after the delegate's
// last method — idempotent, so a second run changes nothing.
const delegate = join(APP, "AppDelegate.swift");
const delegateText = readFileSync(delegate, "utf8");
const FORWARD = `
    // ALERTS: the device token iOS gives the app, handed to Capacitor's push plugin (scripts/ios.configure.mjs).
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
`;
stage(delegate, delegateText.includes("capacitorDidRegisterForRemoteNotifications") ? delegateText : delegateText.replace(/\n\}\s*$/, `\n${FORWARD}}\n`), "AppDelegate.swift");
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
  // An iPhone held upright; an iPad any way up (header, 4). The plain key is the iPhone's; ~ipad is the iPad's own.
  UISupportedInterfaceOrientations: IPHONE_TURNS,
  "UISupportedInterfaceOrientations~ipad": IPAD_TURNS,
  UIRequiredDeviceCapabilities: ["arm64"],
};
let infoChanged = false;
for (const [k, v] of Object.entries(want)) {
  if (JSON.stringify(info[k]) !== JSON.stringify(v)) { info[k] = v; infoChanged = true; }
}
// Never full screen only (header, 4): an iPad shares its screen, and iPadOS 26 deprecated the key that refused to.
for (const k of ["UIRequiresFullScreen", "UIRequiresFullScreen~ipad"]) if (k in info) { delete info[k]; infoChanged = true; }
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

// ── 4 · the project file: the new files, the iPhone and the iPad ───────────────────────────────
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
// The iPhone and the iPad (header, 4), in the app target's Debug and Release alike — written as Xcode writes it. The
// template sets it in both; if it ever stops, this says so rather than leaving the app on one device without a word.
if ((pbx.match(/\t\t\t\tTARGETED_DEVICE_FAMILY = [^;]*;\n/g) || []).length !== 2) throw new Error("ios.configure — the app target no longer sets TARGETED_DEVICE_FAMILY in Debug and Release");
pbx = pbx.replace(/\t\t\t\tTARGETED_DEVICE_FAMILY = [^;]*;\n/g, '\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";\n');
// 7 · the target signs with the app's entitlements (written below), in Debug and Release alike
pbx = pbx.replace(/(\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;\n)(\t\t\t\tCODE_SIGN_STYLE = Automatic;)/g, "$1\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n$2");
if (pbx !== before) stage(PBX, pbx, "App.xcodeproj/project.pbxproj");

// ── 7 · the app's entitlements: Sign in with Apple, and alerts (APNs, the production service — TestFlight and the
// App Store both use it; the App ID carries Push Notifications for the export to sign it) ─────────────────────────
// Universal links and password AutoFill (2026-10-11): app.gt3pb.com's links open the app, and a password saved for
// the site is offered in the app — the site says which addresses (app/.well-known/apple-app-site-association).
put("App.entitlements", plist.build({
  "aps-environment": "production",
  "com.apple.developer.applesignin": ["Default"],
  "com.apple.developer.associated-domains": ["applinks:app.gt3pb.com", "webcredentials:app.gt3pb.com"],
}) + "\n");

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

// ── 8 · what the iPad shows before the page: the icon and the launch screen (2026-10-11) ─────────
// Held, not written: scripts/ios.assets.mjs makes both from native/brand/3.svg, and gt3-brand-lock keeps the mark to
// what that file renders — never redrawn here, never approximated at another size.
//   · The icon set is Xcode's single size: one 1024 × 1024 master, in RGB (Apple refuses an icon with an alpha
//     channel), which Xcode scales at build time to every size each device asks for — the iPad's 152 and 167 px
//     among them — so no iPad size is drawn, committed or able to drift from the master. A set of fixed sizes would
//     need each iPad size added by hand; the iPhone check (.github/workflows/ios.yml) reads the built app for the
//     iPad's icons all the same.
//   · The launch screen is one image filling its view (scaleAspectFill) on the app's charcoal, with no constraints —
//     a 2,732 px square with the glyph at its centre, cropped at the sides of a phone and at the edges of an iPad
//     either way up — never a layout drawn for one screen's size.
const pngSize = (file) => {
  const b = readFileSync(file);
  return b.length > 26 && b.toString("latin1", 12, 16) === "IHDR" ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20), depth: b[24], type: b[25] } : null;
};
const ICONS = join(APP, "Assets.xcassets", "AppIcon.appiconset");
const iconSet = existsSync(join(ICONS, "Contents.json")) ? JSON.parse(readFileSync(join(ICONS, "Contents.json"), "utf8")) : null;
const master = iconSet?.images?.length === 1 ? iconSet.images[0] : null;
if (!master || master.idiom !== "universal" || master.platform !== "ios" || master.size !== "1024x1024" || !master.filename) {
  held.push("the app icon set is not Xcode's single size (one universal iOS 1024 × 1024 image) — Xcode would not make the iPad's sizes from it");
} else {
  const px = existsSync(join(ICONS, master.filename)) ? pngSize(join(ICONS, master.filename)) : null;
  if (!px || px.w !== 1024 || px.h !== 1024 || px.depth !== 8 || px.type !== 2) held.push(`the app icon's master is not a 1024 × 1024 RGB image without alpha (${px ? `${px.w} × ${px.h}, colour type ${px.type}` : "missing"})`);
}
const launchNow = readFileSync(launch, "utf8");
if (!/<imageView key="view" [^>]*contentMode="scaleAspectFill"[^>]*image="Splash"/.test(launchNow) || /<constraint\b/.test(launchNow)) {
  held.push("the launch screen is no longer one Splash image filling its view (scaleAspectFill, no constraints) — it would not fit an iPad either way up");
}
const SPLASH = join(APP, "Assets.xcassets", "Splash.imageset");
const splashSet = existsSync(join(SPLASH, "Contents.json")) ? JSON.parse(readFileSync(join(SPLASH, "Contents.json"), "utf8")) : null;
const splashes = (splashSet?.images ?? []).map((i) => i.filename && existsSync(join(SPLASH, i.filename)) ? pngSize(join(SPLASH, i.filename)) : null);
if (!splashes.length || splashes.some((s) => !s || s.w !== s.h || s.w < 2732)) held.push("the launch image is not a square of at least 2,732 px at every scale — an iPad's longer side would show its edge");

if (held.length) console.log(`ios.configure — made by scripts/ios.assets.mjs, and not as the iPad needs it:\n  · ${held.join("\n  · ")}`);
if (CHECK) {
  if (changed.length) console.log(`ios.configure --check — the committed project differs in: ${changed.join(", ")} (run node scripts/ios.configure.mjs and commit)`);
  else if (!held.length) console.log("ios.configure --check — the committed project says all of this.");
  process.exit(changed.length || held.length ? 1 : 0);
}
console.log(changed.length ? `ios.configure — set: ${changed.join(", ")}` : "ios.configure — the project already says all of this.");
if (held.length) process.exit(1);
