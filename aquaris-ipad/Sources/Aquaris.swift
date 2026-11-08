// The Aquaris iPad app: Aquaris itself (the same web version, kept inside the app) fills the
// screen, and each website you open is a real web view laid exactly over its Aquaris window.
// Websites like Discord refuse to be put inside another web page, but an app can show them
// itself, so here they live inside Aquaris windows, with Aquaris's own title bars and dock.
//
// Aquaris talks to the app with window.webkit.messageHandlers.aquarisShell.postMessage(...):
//   open {id, url}     make a web view for a window      close {id}    reload {id}
//   layout {views}     where each one goes, in front-to-back order, shown or hidden
//   snapshot {id}      a picture of it (shown while something covers it)
//   save {data}        Aquaris's settings (kept by the app)
// and the app answers with Aquaris.shellEvent({type: "loaded" | "snap" | "tap", id, ...}).

import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    window = UIWindow(frame: UIScreen.main.bounds)
    window?.rootViewController = DeskController()
    window?.makeKeyAndVisible()
    return true
  }
}

/// Serves Aquaris's own files from inside the app at aquaris://app/...
final class AquarisFiles: NSObject, WKURLSchemeHandler {
  let root = Bundle.main.url(forResource: "web", withExtension: nil)!.standardizedFileURL
  static let types = ["html": "text/html", "js": "text/javascript", "css": "text/css", "json": "application/json",
                      "svg": "image/svg+xml", "png": "image/png", "webmanifest": "application/manifest+json"]

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else { return }
    var path = url.path
    if path.isEmpty || path.hasSuffix("/") { path += "index.html" }
    let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
    // Only files inside Aquaris's folder
    guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
      task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!)
      task.didFinish()
      return
    }
    let type = Self.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
    task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                    headerFields: ["Content-Type": type, "Content-Length": "\(data.count)"])!)
    task.didReceive(data)
    task.didFinish()
  }
  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class DeskController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, UIGestureRecognizerDelegate {
  private var desk: WKWebView!
  private var apps: [String: WKWebView] = [:]
  private let pool = WKProcessPool()       // one engine for every app: shared sign-ins, less memory

  override var prefersStatusBarHidden: Bool { true }
  override var prefersHomeIndicatorAutoHidden: Bool { true }
  override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .bottom }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(red: 0.04, green: 0.1, blue: 0.18, alpha: 1)

    let config = WKWebViewConfiguration()
    config.processPool = pool
    config.setURLSchemeHandler(AquarisFiles(), forURLScheme: "aquaris")
    config.userContentController.add(self, name: "aquarisShell")
    // Aquaris's settings from last time, ready before Aquaris starts
    let saved = UserDefaults.standard.string(forKey: "aquaris") ?? "null"
    config.userContentController.addUserScript(WKUserScript(source: "window.aquarisSaved = \(saved);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []

    desk = WKWebView(frame: view.bounds, configuration: config)
    desk.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    desk.scrollView.isScrollEnabled = false
    desk.scrollView.bounces = false
    desk.scrollView.contentInsetAdjustmentBehavior = .never
    desk.isOpaque = false
    desk.backgroundColor = .clear
    desk.uiDelegate = self
    desk.navigationDelegate = self
    if #available(iOS 16.4, *) { desk.isInspectable = true }
    view.addSubview(desk)
    desk.load(URLRequest(url: URL(string: "aquaris://app/aquaris/index.html")!))
  }

  // MARK: Messages from Aquaris

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.webView === desk, let msg = message.body as? [String: Any], let cmd = msg["cmd"] as? String else { return }
    let id = msg["id"] as? String ?? ""
    switch cmd {
    case "open": open(id, url: msg["url"] as? String ?? "")
    case "close": apps[id]?.removeFromSuperview(); apps[id] = nil
    case "reload": apps[id]?.reload()
    case "back": apps[id]?.goBack()
    case "forward": apps[id]?.goForward()
    case "layout": layout(msg["views"] as? [[String: Any]] ?? [])
    case "snapshot": snapshot(id)
    case "save": if let data = msg["data"] as? String { UserDefaults.standard.set(data, forKey: "aquaris") }
    default: break
    }
  }

  private func send(_ event: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
    desk.evaluateJavaScript("window.Aquaris && Aquaris.shellEvent(\(json))")
  }
  private func idOf(_ webView: WKWebView) -> String? { apps.first { $0.value === webView }?.key }

  private func open(_ id: String, url: String) {
    guard apps[id] == nil, let address = URL(string: url) else { return }
    let config = WKWebViewConfiguration()
    config.processPool = pool
    config.websiteDataStore = .default()
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    // The full websites (WhatsApp Web, Discord…), not the phone versions
    config.defaultWebpagePreferences.preferredContentMode = .desktop
    let web = WKWebView(frame: .zero, configuration: config)
    web.isHidden = true
    web.navigationDelegate = self
    web.uiDelegate = self
    web.allowsBackForwardNavigationGestures = true
    web.clipsToBounds = true
    web.layer.maskedCorners = [.layerMinXMaxYCorner, .layerMaxXMaxYCorner]
    if #available(iOS 16.4, *) { web.isInspectable = true }
    // Touching an app brings its window to the front
    let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
    tap.cancelsTouchesInView = false
    tap.delegate = self
    web.addGestureRecognizer(tap)
    apps[id] = web
    view.addSubview(web)
    web.load(URLRequest(url: address))
  }

  @objc private func tapped(_ gesture: UITapGestureRecognizer) {
    if let web = gesture.view as? WKWebView, let id = idOf(web) { send(["type": "tap", "id": id]) }
  }
  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

  /// Put each app view over its window (back to front) and show or hide it
  private func layout(_ views: [[String: Any]]) {
    for item in views {
      guard let id = item["id"] as? String, let web = apps[id] else { continue }
      let num = { (key: String) in CGFloat((item[key] as? NSNumber)?.doubleValue ?? 0) }
      web.frame = CGRect(x: num("x"), y: num("y"), width: num("w"), height: num("h"))
      web.layer.cornerRadius = num("radius")
      let show = item["show"] as? Bool ?? false
      if show {
        web.isHidden = false
        view.bringSubviewToFront(web)
      } else if item["snap"] as? Bool == true && !web.isHidden {
        // Hide it once its picture is taken, so the window never looks empty
        web.takeSnapshot(with: nil) { [weak self] image, _ in
          if let image = image { self?.sendSnapshot(id, image) }
          DispatchQueue.main.async { web.isHidden = true }
        }
      } else {
        web.isHidden = true
      }
    }
  }

  private func snapshot(_ id: String) {
    guard let web = apps[id], !web.isHidden else { return }
    web.takeSnapshot(with: nil) { [weak self] image, _ in if let image = image { self?.sendSnapshot(id, image) } }
  }
  private func sendSnapshot(_ id: String, _ image: UIImage) {
    guard let jpeg = image.jpegData(compressionQuality: 0.55) else { return }
    send(["type": "snap", "id": id, "data": "data:image/jpeg;base64," + jpeg.base64EncodedString()])
  }

  // MARK: Websites

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard let id = idOf(webView) else { return }
    send(["type": "loaded", "id": id, "url": webView.url?.absoluteString ?? "", "title": webView.title ?? ""])
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { self.webView(webView, didFinish: navigation) }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { self.webView(webView, didFinish: navigation) }

  // Websites stay inside Aquaris. iPadOS normally hands some addresses to their own app or
  // browser (after signing in, youtube.com goes to the YouTube app, Safari or Chrome); this
  // "allow, without trying the app" answer keeps them in the Aquaris window.
  private static let stayHere = WKNavigationActionPolicy(rawValue: WKNavigationActionPolicy.allow.rawValue + 2) ?? .allow
  // Only these kinds of links may open another app (email, calls, Zoom meetings, maps)
  private static let otherApps: Set<String> = ["mailto", "tel", "sms", "facetime", "facetime-audio", "zoomus", "zoommtg", "maps"]

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { return decisionHandler(.allow) }
    if webView === desk {
      if scheme == "aquaris" || scheme == "about" || scheme == "blob" || scheme == "data" { return decisionHandler(.allow) }
      // Aquaris never leaves its own page: a website it opens gets its own Aquaris window
      if action.targetFrame?.isMainFrame != false, scheme == "http" || scheme == "https" {
        send(["type": "openUrl", "url": url.absoluteString])
        return decisionHandler(.cancel)
      }
      return decisionHandler(Self.stayHere)
    }
    if ["http", "https", "about", "blob", "data", "javascript"].contains(scheme) { return decisionHandler(Self.stayHere) }
    if Self.otherApps.contains(scheme) { UIApplication.shared.open(url) }
    decisionHandler(.cancel)   // youtube://, googlechrome://, intent:… stay closed
  }

  // "Open in a new window" links (and sign-in pop-ups) open in the same app window
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if webView === desk {
      if let url = action.request.url, url.scheme == "http" || url.scheme == "https" { send(["type": "openUrl", "url": url.absoluteString]) }
      return nil
    }
    webView.load(action.request)
    return nil
  }

  // Camera and microphone: the iPad asks you (the first time) and then the site asks
  @available(iOS 15.0, *)
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(.prompt)
  }

  // Websites' own pop-up messages
  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
    present(alert, animated: true)
  }
  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
    alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
    present(alert, animated: true)
  }
  func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
    let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
    alert.addTextField { $0.text = defaultText }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
    alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
    present(alert, animated: true)
  }
}
