import UIKit
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
