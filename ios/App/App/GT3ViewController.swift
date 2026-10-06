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
