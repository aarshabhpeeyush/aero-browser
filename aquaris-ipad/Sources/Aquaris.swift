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
import GameController

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
  private var watching: [String: [NSKeyValueObservation]] = [:]
  private let files = AquarisFiles()
  private let pool = WKProcessPool()       // one engine for every app: shared sign-ins, less memory

  override var prefersStatusBarHidden: Bool { true }

  // Alt+Shift+T (Option+Shift+T on an iPad keyboard): Aquaris's window switcher, from anywhere
  // and the rest of Aquaris's shortcuts, so a Bluetooth keyboard works like on a computer even
  // while a website has the keyboard
  override var keyCommands: [UIKeyCommand]? {
    let commands = [
      UIKeyCommand(title: "Switch window", action: #selector(switchWindow), input: "t", modifierFlags: [.alternate, .shift]),
      UIKeyCommand(title: "Spotlight", action: #selector(spotlightKey), input: " ", modifierFlags: [.alternate]),
      UIKeyCommand(title: "Spotlight", action: #selector(spotlightKey), input: " ", modifierFlags: [.control]),
      UIKeyCommand(title: "Lock", action: #selector(lockKey), input: "l", modifierFlags: [.control, .alternate])
    ]
    commands.forEach { $0.wantsPriorityOverSystemBehavior = true }
    return commands
  }
  @objc private func spotlightKey() { send(["type": "key", "key": "spotlight"]) }
  @objc private func lockKey() { send(["type": "key", "key": "lock"]) }
  override var canBecomeFirstResponder: Bool { true }
  @objc private func switchWindow() { send(["type": "switch"]) }
  override var prefersHomeIndicatorAutoHidden: Bool { true }
  override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .bottom }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(red: 0.04, green: 0.1, blue: 0.18, alpha: 1)

    let config = WKWebViewConfiguration()
    config.processPool = pool
    config.setURLSchemeHandler(files, forURLScheme: "aquaris")
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
    pad = PadCursor(owner: self)
    pad?.start()
  }
  private var pad: PadCursor?

  // MARK: Game controller: what the cursor touches

  /// The website window under a point (the front-most one), if any
  private func appView(at p: CGPoint) -> (String, WKWebView)? {
    for sub in view.subviews.reversed() {
      guard let web = sub as? WKWebView, web !== desk, !web.isHidden, web.frame.contains(p), let id = idOf(web) else { continue }
      return (id, web)
    }
    return nil
  }
  private var padDownOnDesk = false
  private func deskPad(_ action: String, _ p: CGPoint, _ dx: CGFloat = 0, _ dy: CGFloat = 0) {
    desk.evaluateJavaScript("window.Aquaris && Aquaris.pad('\(action)', \(p.x), \(p.y), \(dx), \(dy))")
  }
  /// A click (or right-click) on a website: the page gets the same events a mouse would give it
  private func clickInPage(_ web: WKWebView, _ p: CGPoint, right: Bool) {
    let local = CGPoint(x: p.x - web.frame.minX, y: p.y - web.frame.minY)
    let js = """
    (function(x,y,right){var el=document.elementFromPoint(x,y);if(!el)return;
    var o={bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,screenX:x,screenY:y,button:right?2:0,buttons:right?2:1,view:window};
    if(right){el.dispatchEvent(new MouseEvent('contextmenu',o));return;}
    var p=function(t,b){try{el.dispatchEvent(new PointerEvent(t,Object.assign({},o,{pointerId:1,pointerType:'mouse',isPrimary:true,buttons:b})));}catch(e){}};
    p('pointerdown',1);el.dispatchEvent(new MouseEvent('mousedown',o));
    if(el.focus)el.focus();
    p('pointerup',0);el.dispatchEvent(new MouseEvent('mouseup',Object.assign({},o,{buttons:0})));
    el.click();})(\(local.x),\(local.y),\(right))
    """
    web.evaluateJavaScript(js)
  }
  func padPress(_ down: Bool, at p: CGPoint) {
    if down {
      if let hit = appView(at: p) {
        let (id, web) = hit
        padDownOnDesk = false
        send(["type": "tap", "id": id])
        clickInPage(web, p, right: false)
      } else {
        padDownOnDesk = true
        deskPad("down", p)
      }
    } else if padDownOnDesk {
      padDownOnDesk = false
      deskPad("up", p)
    }
  }
  func padMove(_ p: CGPoint) { if padDownOnDesk { deskPad("move", p) } }
  func padRightClick(at p: CGPoint) {
    if let hit = appView(at: p) {
      let (id, web) = hit
      send(["type": "tap", "id": id])
      clickInPage(web, p, right: true)
    } else {
      deskPad("right", p)
    }
  }
  func padScroll(at p: CGPoint, dx: CGFloat, dy: CGFloat) {
    if let hit = appView(at: p) {
      let web = hit.1
      let s = web.scrollView
      let maxX = max(0, s.contentSize.width - s.bounds.width), maxY = max(0, s.contentSize.height - s.bounds.height)
      s.setContentOffset(CGPoint(x: min(maxX, max(0, s.contentOffset.x + dx)), y: min(maxY, max(0, s.contentOffset.y + dy))), animated: false)
    } else {
      deskPad("scroll", p, dx, dy)
    }
  }
  func padButton(_ action: String) { deskPad(action, .zero) }

  // MARK: Messages from Aquaris

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.webView === desk, let msg = message.body as? [String: Any], let cmd = msg["cmd"] as? String else { return }
    let id = msg["id"] as? String ?? ""
    switch cmd {
    case "open": open(id, url: msg["url"] as? String ?? "")
    case "close": apps[id]?.removeFromSuperview(); apps[id] = nil; watching[id] = nil
    case "reload": apps[id]?.reload()
    case "stop": apps[id]?.stopLoading()
    case "zoom": if let z = (msg["value"] as? NSNumber)?.doubleValue { apps[id]?.pageZoom = CGFloat(z) }
    case "go": if let url = URL(string: msg["url"] as? String ?? "") { apps[id]?.load(URLRequest(url: url)) }
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
    config.setURLSchemeHandler(files, forURLScheme: "aquaris")   // Aeris's New Tab page
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
    // Two fingers swiping sideways over a website: Aquaris's window switcher
    let swipe = UIPanGestureRecognizer(target: self, action: #selector(swiped(_:)))
    swipe.minimumNumberOfTouches = 2
    swipe.maximumNumberOfTouches = 2
    swipe.cancelsTouchesInView = false
    swipe.delegate = self
    web.addGestureRecognizer(swipe)
    apps[id] = web
    view.addSubview(web)
    // Tell Aquaris where the page is, its title, and whether back / forward work (for Aeris's toolbar)
    let changed: (WKWebView, Any) -> Void = { [weak self] web, _ in self?.sendState(web) }
    watching[id] = [web.observe(\.url, changeHandler: changed), web.observe(\.title, changeHandler: changed),
                    web.observe(\.canGoBack, changeHandler: changed), web.observe(\.canGoForward, changeHandler: changed),
                    web.observe(\.isLoading, changeHandler: changed)]
    web.load(URLRequest(url: address))
  }

  private func sendState(_ web: WKWebView) {
    guard let id = idOf(web) else { return }
    send(["type": "state", "id": id, "url": web.url?.absoluteString ?? "", "title": web.title ?? "",
          "back": web.canGoBack, "forward": web.canGoForward, "loading": web.isLoading])
  }

  @objc private func tapped(_ gesture: UITapGestureRecognizer) {
    if let web = gesture.view as? WKWebView, let id = idOf(web) { send(["type": "tap", "id": id]) }
  }
  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

  private var swipeSteps = 0, swipeOn = false
  @objc private func swiped(_ g: UIPanGestureRecognizer) {
    let move = g.translation(in: view)
    switch g.state {
    case .began:
      swipeSteps = 0; swipeOn = false
    case .changed:
      if !swipeOn && abs(move.x) > 50 && abs(move.x) > abs(move.y) * 1.5 {
        swipeOn = true
        send(["type": "switch", "step": 1, "gesture": true])
      }
      if swipeOn {
        let want = Int(move.x / 90)
        while swipeSteps < want { swipeSteps += 1; send(["type": "switch", "step": 1, "gesture": true]) }
        while swipeSteps > want { swipeSteps -= 1; send(["type": "switch", "step": -1, "gesture": true]) }
      }
    case .ended, .cancelled, .failed:
      if swipeOn { send(["type": "switchEnd"]) }
      swipeOn = false
    default: break
    }
  }

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
    if ["http", "https", "about", "blob", "data", "javascript", "aquaris"].contains(scheme) { return decisionHandler(Self.stayHere) }
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


// MARK: - Game controller

/// The arrow the controller moves around (drawn above everything, websites included)
final class CursorView: UIView {
  override init(frame: CGRect) {
    super.init(frame: CGRect(x: 0, y: 0, width: 22, height: 30))
    isUserInteractionEnabled = false
    backgroundColor = .clear
    layer.shadowColor = UIColor.black.cgColor
    layer.shadowOpacity = 0.35
    layer.shadowRadius = 2
    layer.shadowOffset = CGSize(width: 0, height: 1)
  }
  required init?(coder: NSCoder) { fatalError() }
  override func draw(_ rect: CGRect) {
    let arrow = UIBezierPath()
    arrow.move(to: CGPoint(x: 2, y: 2))
    arrow.addLine(to: CGPoint(x: 2, y: 24))
    arrow.addLine(to: CGPoint(x: 8, y: 18.5))
    arrow.addLine(to: CGPoint(x: 12, y: 27))
    arrow.addLine(to: CGPoint(x: 15.5, y: 25.5))
    arrow.addLine(to: CGPoint(x: 11.5, y: 17))
    arrow.addLine(to: CGPoint(x: 19, y: 17))
    arrow.close()
    UIColor.white.setFill()
    arrow.fill()
    UIColor.black.setStroke()
    arrow.lineWidth = 1.5
    arrow.lineJoinStyle = .round
    arrow.stroke()
  }
}

/// Reads a connected controller: the left stick (or D-pad) moves the cursor, R1 clicks (hold to
/// drag), L1 right-clicks, the right stick scrolls, and the other buttons open parts of Aquaris.
/// Buttons are matched by the label on them, so "X" is X on Xbox and Cross on PlayStation.
final class PadCursor: NSObject {
  private unowned let owner: DeskController
  private let arrow = CursorView()
  private var pos = CGPoint(x: 300, y: 300)
  private var link: CADisplayLink?
  private var idle: Double = 0
  private var slow = false
  private var holding = false

  init(owner: DeskController) { self.owner = owner }

  func start() {
    arrow.isHidden = true
    owner.view.addSubview(arrow)
    NotificationCenter.default.addObserver(forName: .GCControllerDidConnect, object: nil, queue: .main) { [weak self] note in
      if let c = note.object as? GCController { self?.attach(c) }
    }
    NotificationCenter.default.addObserver(forName: .GCControllerDidDisconnect, object: nil, queue: .main) { [weak self] _ in
      if GCController.controllers().isEmpty { self?.arrow.isHidden = true }
    }
    GCController.controllers().forEach(attach)
  }

  private func attach(_ controller: GCController) {
    guard let pad = controller.extendedGamepad else { return }
    var playStation = pad is GCDualShockGamepad
    if #available(iOS 14.5, *) { playStation = playStation || pad is GCDualSenseGamepad }
    let on: (GCControllerButtonInput?, @escaping (Bool) -> Void) -> Void = { button, act in
      button?.pressedChangedHandler = { _, _, pressed in act(pressed) }
    }
    let tap: (GCControllerButtonInput?, String) -> Void = { [weak self] button, action in
      on(button) { if $0 { self?.show(); self?.owner.padButton(action) } }
    }
    on(pad.rightShoulder) { [weak self] pressed in
      guard let self else { return }
      self.show()
      self.holding = pressed
      self.owner.padPress(pressed, at: self.pos)
    }
    on(pad.leftShoulder) { [weak self] pressed in
      guard let self, pressed else { return }
      self.show()
      self.owner.padRightClick(at: self.pos)
    }
    tap(playStation ? pad.buttonA : pad.buttonX, "spotlight")   // X
    tap(playStation ? pad.buttonX : pad.buttonA, "control")     // Square / A
    tap(pad.buttonY, "apps")                                    // Triangle / Y
    tap(pad.buttonB, "back")                                    // Circle / B
    tap(pad.rightTrigger, "nextWin")
    tap(pad.leftTrigger, "prevWin")
    tap(pad.buttonMenu, "menu")
    tap(pad.buttonOptions, "desktop")
    on(pad.leftThumbstickButton) { [weak self] pressed in if pressed { self?.slow.toggle() } }
    tap(pad.rightThumbstickButton, "switch")                    // R3: the window switcher
    if link == nil {
      link = CADisplayLink(target: self, selector: #selector(tick(_:)))
      link?.add(to: .main, forMode: .common)
    }
    show()
  }

  private func show() {
    idle = 0
    if arrow.isHidden {
      arrow.isHidden = false
      pos.x = min(max(pos.x, 0), owner.view.bounds.width - 4)
      pos.y = min(max(pos.y, 0), owner.view.bounds.height - 4)
      arrow.frame.origin = CGPoint(x: pos.x - 2, y: pos.y - 2)
    }
    owner.view.bringSubviewToFront(arrow)
  }

  @objc private func tick(_ link: CADisplayLink) {
    guard let pad = (GCController.current ?? GCController.controllers().first)?.extendedGamepad else { return }
    let dt = CGFloat(min(0.05, max(0.001, link.targetTimestamp - link.timestamp)))
    // Move: the stick, with a curve so small pushes are precise; the D-pad for tiny steps
    var vx = CGFloat(pad.leftThumbstick.xAxis.value), vy = CGFloat(-pad.leftThumbstick.yAxis.value)
    let mag = hypot(vx, vy)
    if mag < 0.12 { vx = 0; vy = 0 } else {
      let speed = (slow ? 380 : 1250) * pow(min(mag, 1), 1.7) / mag
      vx *= speed; vy *= speed
    }
    vx += CGFloat(pad.dpad.xAxis.value) * 160
    vy += CGFloat(-pad.dpad.yAxis.value) * 160
    if vx != 0 || vy != 0 {
      show()
      let b = owner.view.bounds
      pos.x = min(max(pos.x + vx * dt, 0), b.width - 2)
      pos.y = min(max(pos.y + vy * dt, 0), b.height - 2)
      arrow.frame.origin = CGPoint(x: pos.x - 2, y: pos.y - 2)
      if holding { owner.padMove(pos) }
    } else {
      idle += Double(dt)
      if idle > 10 && !holding { arrow.isHidden = true }
    }
    // Scroll with the right stick
    let sx = CGFloat(pad.rightThumbstick.xAxis.value), sy = CGFloat(-pad.rightThumbstick.yAxis.value)
    if abs(sx) > 0.15 || abs(sy) > 0.15 {
      show()
      owner.padScroll(at: pos, dx: sx * 1100 * dt, dy: sy * 1100 * dt)
    }
  }
}
