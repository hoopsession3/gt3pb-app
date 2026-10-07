import UIKit
import Capacitor
import EventKit
import EventKitUI
import PassKit

/// WHAT THE PHONE DOES FOR A PAGE (2026-10-06, the iPhone round, part 3).
///
/// The source is native/ios/GT3Device.swift; scripts/ios.configure.mjs copies it into the app's target
/// (ios/App/App/GT3Device.swift) and GT3ViewController registers it. Edit it here, never the copy —
/// `node scripts/ios.configure.mjs --check` (scripts/smoke.cjs runs it) fails while the two differ.
///
/// The web's ways of saving a file, printing a page, adding an event to a calendar or a pass to Wallet
/// are browser tricks a WKWebView does not perform: an <a download> goes nowhere, window.print() does
/// nothing, an .ics or a .pkpass file has nothing to open it. lib/deviceActions.ts is the one place a
/// page asks for any of them; in the app it asks here, and the phone's own sheet does the rest:
///
///   · keepFile  — a file put where the share sheet can hand it on (@capacitor/share presents the
///                 sheet: Save to Files, Save Image, AirDrop, Mail, Messages, Instagram…), written from
///                 the page's own bytes, or fetched from an https address — a post's photo, say.
///   · printPage — the system print panel, of the page as it is: its print styles apply, as in Safari.
///   · addEvent  — the system's own New Event sheet, filled in; one tap saves it to whichever calendar
///                 the person picks. From iOS 17 it needs no calendar permission at all (the sheet runs
///                 outside the app); on iOS 15 and 16 the phone asks once (NSCalendarsUsageDescription).
///   · addPass   — Wallet's own Add sheet, for a membership pass.
@objc(GT3DevicePlugin)
public class GT3DevicePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GT3DevicePlugin"
    public let jsName = "GT3Device"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "keepFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printPage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addPass", returnType: CAPPluginReturnPromise)
    ]

    private lazy var store = EKEventStore()
    private var eventCall: CAPPluginCall?
    private var passCall: CAPPluginCall?
    private var swept = false

    // MARK: - a file for the share sheet

    /// Each file in a folder of its own, so two files of the same name never meet. The app's temporary
    /// folder is the phone's to clear; the first file of each run of the app clears what the last run
    /// left, so nothing piles up while the app stays installed.
    @objc func keepFile(_ call: CAPPluginCall) {
        let files = FileManager.default.temporaryDirectory.appendingPathComponent("gt3-files", isDirectory: true)
        if !swept {
            try? FileManager.default.removeItem(at: files)
            swept = true
        }
        let folder = files.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let file = folder.appendingPathComponent(GT3DevicePlugin.safeName(call.getString("name") ?? ""))
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            call.reject("Couldn't make room for the file", nil, error)
            return
        }

        if let contents = call.getString("data") {
            guard let bytes = Data(base64Encoded: contents) else {
                call.reject("The file didn't arrive whole")
                return
            }
            do {
                try bytes.write(to: file, options: .atomic)
                call.resolve(["uri": file.absoluteString])
            } catch {
                call.reject("Couldn't keep the file", nil, error)
            }
            return
        }

        guard let address = call.getString("url"), let source = URL(string: address), source.scheme == "https" else {
            call.reject("A file needs its contents or an https address")
            return
        }
        URLSession.shared.downloadTask(with: source) { downloaded, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard let downloaded = downloaded, error == nil, (200..<300).contains(status) else {
                call.reject("Couldn't fetch the file", nil, error)
                return
            }
            // The system deletes the download when this returns, so it is moved first.
            do {
                try FileManager.default.moveItem(at: downloaded, to: file)
                call.resolve(["uri": file.absoluteString])
            } catch {
                call.reject("Couldn't keep the file", nil, error)
            }
        }.resume()
    }

    /// Letters, digits, dots, dashes, underscores and spaces; anything else becomes a dash.
    static func safeName(_ name: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._- "))
        var kept = String.UnicodeScalarView()
        for scalar in name.unicodeScalars {
            kept.append(allowed.contains(scalar) ? scalar : "-")
        }
        let trimmed = String(kept).trimmingCharacters(in: CharacterSet(charactersIn: ". -"))
        return trimmed.isEmpty ? "gt3-file" : String(trimmed.prefix(120))
    }

    // MARK: - print

    @objc func printPage(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else {
                call.reject("There is no page to print")
                return
            }
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = call.getString("name") ?? "GT3"
            let panel = UIPrintInteractionController.shared
            panel.printInfo = info
            panel.printFormatter = webView.viewPrintFormatter()
            let shown = panel.present(animated: true) { _, completed, error in
                if let error = error {
                    call.reject("Couldn't print", nil, error)
                    return
                }
                call.resolve(["printed": completed])
            }
            if !shown {
                call.reject("This phone can't print right now")
            }
        }
    }

    // MARK: - add to the calendar

    @objc func addEvent(_ call: CAPPluginCall) {
        guard let title = call.getString("title"), let start = call.getDouble("start") else {
            call.reject("An event needs a title and a start")
            return
        }
        let show = {
            DispatchQueue.main.async {
                guard let presenter = self.presenter() else {
                    call.reject("There is nothing to show the event on")
                    return
                }
                let allDay = call.getBool("allDay") ?? false
                let begins = Date(timeIntervalSince1970: start / 1000)
                var ends = begins.addingTimeInterval(allDay ? 0 : 3600)
                if let end = call.getDouble("end") {
                    let asked = Date(timeIntervalSince1970: end / 1000)
                    if asked >= begins { ends = asked }
                }
                let event = EKEvent(eventStore: self.store)
                event.title = title
                event.isAllDay = allDay
                event.startDate = begins
                event.endDate = ends
                event.location = call.getString("location")
                event.notes = call.getString("notes")
                if let link = call.getString("url") {
                    event.url = URL(string: link)
                }
                let sheet = EKEventEditViewController()
                sheet.eventStore = self.store
                sheet.event = event
                sheet.editViewDelegate = self
                self.eventCall = call
                presenter.present(sheet, animated: true)
            }
        }
        if #available(iOS 17.0, *) {
            show()
        } else {
            store.requestAccess(to: .event) { granted, _ in
                if granted {
                    show()
                } else {
                    call.reject("Calendar access is off for GT3", "DENIED")
                }
            }
        }
    }

    // MARK: - add to Wallet

    @objc func addPass(_ call: CAPPluginCall) {
        guard let contents = call.getString("data"), let bytes = Data(base64Encoded: contents) else {
            call.reject("The pass didn't arrive whole")
            return
        }
        let pass: PKPass
        do {
            pass = try PKPass(data: bytes)
        } catch {
            call.reject("That isn't a Wallet pass", nil, error)
            return
        }
        DispatchQueue.main.async {
            guard PKAddPassesViewController.canAddPasses(),
                  let sheet = PKAddPassesViewController(pass: pass),
                  let presenter = self.presenter() else {
                call.reject("Wallet can't add a pass on this phone")
                return
            }
            sheet.delegate = self
            self.passCall = call
            presenter.present(sheet, animated: true)
        }
    }

    // MARK: -

    /// The screen on top: a sheet the app is already showing, or the app itself.
    private func presenter() -> UIViewController? {
        var top = bridge?.viewController
        while let next = top?.presentedViewController {
            top = next
        }
        return top
    }
}

extension GT3DevicePlugin: EKEventEditViewDelegate {
    public func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
        controller.dismiss(animated: true)
        eventCall?.resolve(["added": action == .saved])
        eventCall = nil
    }
}

extension GT3DevicePlugin: PKAddPassesViewControllerDelegate {
    public func addPassesViewControllerDidFinish(_ controller: PKAddPassesViewController) {
        controller.dismiss(animated: true)
        passCall?.resolve()
        passCall = nil
    }
}
