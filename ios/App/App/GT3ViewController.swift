import UIKit
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
        zoomWatch = webView?.scrollView.observe(\.contentSize, options: [.new]) { scroll, _ in
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
