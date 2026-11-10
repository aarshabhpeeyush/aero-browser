package io.github.aarshabhpeeyush.aero

import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.app.role.RoleManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.os.PowerManager
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import android.webkit.RenderProcessGoneDetail
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.window.OnBackInvokedDispatcher
import androidx.webkit.ProfileStore
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream

private const val INCOGNITO = "aero-private"
private const val REQ_FILE = 7
private const val REQ_IMPORT = 8
private const val REQ_EXPORT = 9
private const val REQ_ROLE = 10
private const val VERSION = "1.1.0"
private const val APP_PAGES = "https://appassets.androidplatform.net/assets/"

// Android 10: draw behind the status and navigation bars (newer Android does this with setDecorFitsSystemWindows).
@Suppress("DEPRECATION")
private const val EDGE_TO_EDGE =
    View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
private const val DESKTOP_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"

class MainActivity : Activity() {

    private lateinit var prefs: SharedPreferences
    private lateinit var assets: WebViewAssetLoader
    private val handler = Handler(Looper.getMainLooper())

    private val tabs = mutableListOf<Tab>()
    private var current: Tab? = null
    private var splitTab: Tab? = null // the second tab shown in split screen
    private val closed = ArrayDeque<Pair<String, String>>() // recently closed (address, title)

    // Views
    private lateinit var root: FrameLayout
    private lateinit var column: LinearLayout
    private lateinit var topBar: LinearLayout
    private lateinit var address: EditText
    private lateinit var shield: TextView
    private lateinit var tabsButton: TextView
    private lateinit var menuButton: TextView
    private lateinit var progress: ProgressBar
    private lateinit var content: LinearLayout
    private lateinit var paneA: FrameLayout
    private lateinit var paneB: FrameLayout
    private lateinit var divider: FrameLayout
    private var splitShare = 0.5f // how much of the screen the first split pane gets
    private lateinit var fullscreen: FrameLayout
    private var overlay: View? = null
    private var insetTop = 0
    private var insetBottom = 0

    // Full-screen video
    private var customView: View? = null
    private var customCallback: WebChromeClient.CustomViewCallback? = null

    // Apps sidebar
    private var appsPanel: FrameLayout? = null
    private val appViews = mutableMapOf<String, WebView>()

    private var fileCallback: ValueCallback<Array<Uri>>? = null

    // The script every page runs at its start (theme, Aero style, saving files). Rebuilt when settings change.
    private var pageScript = ""
    // Aeris's look: a colour theme with an optional custom theme on top. With "Day and night themes"
    // on, the night look is used from 7 pm to 7 am.
    private val nightNow get() = prefs.getBoolean("scheduleOn", false) &&
        java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY).let { it >= 19 || it < 7 }
    private val colorTheme get() = (if (nightNow) prefs.getString("nightColor", "midnight") else prefs.getString("colorTheme", "frost")) ?: "frost"
    private val customTheme get() = (if (nightNow) prefs.getString("nightTheme", "") else prefs.getString("theme", ""))?.takeIf { it.isNotEmpty() }
    private fun studio() = ColorTheme("studio", "Your own look", prefs.getInt("studioA", 0xFF1F7FD6.toInt()),
        prefs.getInt("studioB", 0xFF7FD0FF.toInt()), prefs.getInt("studioAccent", 0xFF1E9BE8.toInt()), prefs.getFloat("studioGloss", 0.9f))
    private val look get() = Themes.look(this, colorTheme, customTheme, studio())
    private var lookShown = "" // the look the pages have now, to notice when day turns to night
    private fun lookKey() = "$colorTheme|$customTheme"
    private fun zaps() = runCatching { JSONObject(prefs.getString("zaps", "{}")!!) }.getOrDefault(JSONObject())

    // Spaces, notes, history, focus mode, break reminders
    private var space = "home"
    private val history = ArrayDeque<Pair<String, String>>() // pages you visited (address, title), newest first
    private var focus = false
    private var focusOrb: TextView? = null
    private var zapPending = false
    private var browsingSince = System.currentTimeMillis()
    private var pausedAt = 0L
    private var breakShowing = false
    private val barAtBottom get() = prefs.getBoolean("barBottom", false)

    private val dp = { v: Int -> Gloss.dp(this, v) }

    // ================= Start up =================

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences("aero", MODE_PRIVATE)
        assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        // Test builds let the PC look inside pages (chrome://inspect) and log page messages.
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        wipePrivateData() // in case the app was closed while private tabs were open
        // From Aero 0.2.0: "classic" was the plain sky-blue look, which is now the Aqua Sky colour theme.
        if (prefs.getString("theme", null) == "classic") prefs.edit().putString("theme", "").putString("colorTheme", "aqua").apply()
        space = prefs.getString("space", "home") ?: "home"
        loadHistory()
        pageScript = Themes.pageScript(this, customTheme, prefs.getBoolean("aeroStyle", true), zaps())
        lookShown = lookKey()
        buildUi()
        restoreTabs()
        openFromIntent(intent)
        if (current == null) showTab(tabs.firstOrNull() ?: newTab())

        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { goBack() }
        }
        handler.postDelayed(sleepCheck, 30_000)
        // The welcome tour runs once (also for people coming from Aero 0.2.0); What's new after later updates.
        val seen = prefs.getString("seenVersion", null)
        prefs.edit().putString("seenVersion", VERSION).apply()
        if (!prefs.getBoolean("welcomed", false)) handler.postDelayed({ showWelcome() }, 300)
        else if (seen != VERSION) handler.postDelayed({ whatsNew() }, 800)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openFromIntent(intent)
    }

    private fun openFromIntent(intent: Intent?) {
        val link = intent?.data?.toString() ?: return
        if (intent.action == Intent.ACTION_VIEW && (link.startsWith("http://") || link.startsWith("https://"))) {
            showTab(newTab(link))
        }
    }

    override fun onPause() {
        super.onPause()
        saveTabs()
        saveHistory()
        pausedAt = System.currentTimeMillis()
        tabs.forEach { it.webView?.onPause() }
    }

    override fun onResume() {
        super.onResume()
        // Away for 5 minutes or more counts as a break.
        if (pausedAt > 0 && System.currentTimeMillis() - pausedAt > 5 * 60_000) browsingSince = System.currentTimeMillis()
        current?.webView?.onResume()
        splitTab?.webView?.onResume()
    }

    @Deprecated("Android 12 and older")
    override fun onBackPressed() = goBack()

    private fun goBack() {
        val app = appsPanel
        val tab = current?.webView
        when {
            customView != null -> leaveFullscreen(fromPage = false)
            overlay != null -> closeOverlay()
            app != null && app.visibility == View.VISIBLE -> app.visibility = View.GONE
            tab != null && tab.canGoBack() -> tab.goBack()
            focus -> setFocus(false)
            else -> moveTaskToBack(true)
        }
    }

    // ================= Layout =================

    private fun buildUi() {
        root = FrameLayout(this).apply { setBackgroundColor(0xFF3AA6F0.toInt()) }
        column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            // Lets the address bar hand its focus back after a search, so it shows the page's address again.
            isFocusableInTouchMode = true
        }
        root.addView(column, FrameLayout.LayoutParams(-1, -1))

        // Top bar: address pill, ad shield, tab count, menu
        topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        address = EditText(this).apply {
            hint = "Search or type a web address"
            setSingleLine()
            textSize = 16f
            setTextColor(Gloss.INK)
            setHintTextColor(0x9904345C.toInt())
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_GO
            background = Gloss.shape(this@MainActivity, Gloss.GLASS, 999)
            setPadding(dp(16), dp(8), dp(16), dp(8))
            setSelectAllOnFocus(true)
            setOnEditorActionListener { _, action, event ->
                val enter = action == EditorInfo.IME_ACTION_GO || event?.action == KeyEvent.ACTION_DOWN
                if (enter) go(text.toString())
                true
            }
            setOnFocusChangeListener { _, has -> if (!has) updateBar() }
        }
        topBar.addView(address, LinearLayout.LayoutParams(0, dp(42), 1f))
        shield = Gloss.orb(this, "🛡", Gloss.GREEN).apply { setOnClickListener { shieldDialog() } }
        tabsButton = Gloss.orb(this, "1").apply { setOnClickListener { showTabsPanel() } }
        menuButton = Gloss.orb(this, "⋮").apply { setOnClickListener { showMenu(it) } }
        for (b in listOf(shield, tabsButton, menuButton)) {
            topBar.addView(b, LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginStart = dp(8) })
        }
        column.addView(topBar, LinearLayout.LayoutParams(-1, -2))

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progressTintList = android.content.res.ColorStateList.valueOf(0xFF6FE04A.toInt())
            visibility = View.INVISIBLE
        }
        column.addView(progress, LinearLayout.LayoutParams(-1, dp(3)))

        // Web pages: one pane, or two side by side in split screen
        content = LinearLayout(this)
        paneA = FrameLayout(this)
        paneB = FrameLayout(this).apply { visibility = View.GONE }
        divider = makeDivider()
        content.addView(paneA)
        content.addView(divider)
        content.addView(paneB)
        column.addView(content, LinearLayout.LayoutParams(-1, 0, 1f))
        layoutSplit()

        fullscreen = FrameLayout(this).apply { setBackgroundColor(Color.BLACK); visibility = View.GONE }
        root.addView(fullscreen, FrameLayout.LayoutParams(-1, -1))

        // Draw behind the status and navigation bars, and pad our own bars instead.
        root.setOnApplyWindowInsetsListener { _, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                insetTop = bars.top
                insetBottom = bars.bottom
            } else {
                @Suppress("DEPRECATION")
                insetTop = insets.systemWindowInsetTop
                @Suppress("DEPRECATION")
                insetBottom = insets.systemWindowInsetBottom
            }
            placeBar()
            overlay?.setPadding(dp(12), insetTop + dp(12), dp(12), insetBottom + dp(12))
            appsPanel?.setPadding(0, insetTop, 0, insetBottom)
            insets
        }
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false)
        else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = EDGE_TO_EDGE
            @Suppress("DEPRECATION")
            window.statusBarColor = Color.TRANSPARENT
            @Suppress("DEPRECATION")
            window.navigationBarColor = Color.TRANSPARENT
        }
        setContentView(root)
        placeBar()
        updateBar()
    }

    // The address bar sits at the top, or at the bottom where thumbs reach it more easily.
    private fun placeBar() {
        column.removeView(topBar)
        column.removeView(progress)
        if (focus) {
            column.setPadding(0, insetTop, 0, insetBottom)
            focusOrb?.let { (it.layoutParams as FrameLayout.LayoutParams).bottomMargin = insetBottom + dp(14); it.requestLayout() }
            return
        }
        if (barAtBottom) {
            column.addView(progress, LinearLayout.LayoutParams(-1, dp(3)))
            column.addView(topBar, LinearLayout.LayoutParams(-1, -2))
            topBar.setPadding(dp(10), dp(6), dp(10), insetBottom + dp(6))
            column.setPadding(0, insetTop, 0, 0)
        } else {
            column.addView(topBar, 0, LinearLayout.LayoutParams(-1, -2))
            column.addView(progress, 1, LinearLayout.LayoutParams(-1, dp(3)))
            topBar.setPadding(dp(10), insetTop + dp(6), dp(10), dp(6))
            column.setPadding(0, 0, 0, insetBottom)
        }
    }

    private fun layoutSplit() {
        val sideBySide = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        content.orientation = if (sideBySide) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
        val pane = { share: Float -> if (sideBySide) LinearLayout.LayoutParams(0, -1, share) else LinearLayout.LayoutParams(-1, 0, share) }
        paneA.layoutParams = pane(splitShare)
        paneB.layoutParams = pane(1f - splitShare)
        divider.layoutParams = if (sideBySide) LinearLayout.LayoutParams(dp(14), -1) else LinearLayout.LayoutParams(-1, dp(14))
        (divider.getChildAt(0).layoutParams as FrameLayout.LayoutParams).apply {
            width = if (sideBySide) dp(6) else dp(48)
            height = if (sideBySide) dp(48) else dp(6)
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        layoutSplit()
    }

    // Top bar shows the focused tab's address, private colours and the shield state.
    private fun updateBar() {
        val tab = current ?: return
        val l = look
        topBar.background = Gloss.shape(this, if (tab.incognito) Gloss.PRIVATE else l.bar, 0, strokeColor = 0x66FFFFFF)
        val orbs = if (tab.incognito) Gloss.PRIVATE else l.orbs
        tabsButton.background = Gloss.shape(this, orbs, 0, oval = true)
        menuButton.background = Gloss.shape(this, orbs, 0, oval = true)
        root.setBackgroundColor(l.bar[3])
        address.hint = if (tab.incognito) "Private tab: search or type an address" else "Search or type a web address"
        if (!address.hasFocus()) address.setText(when {
            tab.isNewTab -> ""
            tab.url.startsWith(APP_PAGES) -> "Aeris · " + tab.title
            else -> tab.url
        })
        tabsButton.text = tabs.count { it.space == space }.toString()
        val blocking = adBlockOn(tab.pageHost)
        shield.background = Gloss.shape(this, if (blocking) Gloss.GREEN else Gloss.GREY, 0, oval = true)
        shield.alpha = if (tab.url.startsWith(APP_PAGES)) 0.5f else 1f
        val split = splitTab != null
        paneA.foreground = if (split && current?.webView?.parent == paneA) focusRing() else null
        paneB.foreground = if (split && current?.webView?.parent == paneB) focusRing() else null
    }

    private fun focusRing() = GradientDrawable().apply { setStroke(dp(3), 0xFF2FB8FF.toInt()) }

    // ================= Tabs =================

    // A tab opened "under" another (tab stacking) sits right after it, and closing it goes back there.
    private fun newTab(url: String = NEW_TAB, incognito: Boolean = false, under: Tab? = null): Tab {
        val tab = Tab(incognito, url)
        tab.space = under?.space ?: space
        tab.parent = under
        val at = under?.let { tabs.indexOf(it) } ?: -1
        if (at >= 0) tabs.add(at + 1, tab) else tabs.add(tab)
        return tab
    }

    private fun privateTabsWork(): Boolean {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) return true
        AlertDialog.Builder(this)
            .setTitle("Private tabs need an update")
            .setMessage("Update \"Android System WebView\" from the Play Store, then try again.")
            .setPositiveButton("OK", null).show()
        return false
    }

    private fun newPrivateTab() {
        if (privateTabsWork()) showTab(newTab(incognito = true))
    }

    private fun showTab(tab: Tab) {
        if (tab.space != space) { // a tab from another space: go to that space
            if (splitTab != null) leaveSplit()
            space = tab.space
            prefs.edit().putString("space", space).apply()
        }
        if (tab == splitTab) { // tapping the other split pane just moves the focus
            splitTab = current
            current = tab
            updateBar()
            return
        }
        val pane = (current?.webView?.parent as? FrameLayout) ?: paneA
        current?.let { if (it != tab) { it.webView?.onPause(); it.lastUsed = System.currentTimeMillis() } }
        current = tab
        tab.lastUsed = System.currentTimeMillis()
        val wv = wake(tab)
        if (wv.parent != pane) {
            (wv.parent as? ViewGroup)?.removeView(wv)
            pane.removeAllViews()
            pane.addView(wv, FrameLayout.LayoutParams(-1, -1))
        }
        wv.onResume()
        updateBar()
    }

    private fun closeTab(tab: Tab) {
        if (!tab.incognito && !tab.isNewTab) {
            closed.addFirst(tab.url to tab.title)
            while (closed.size > 15) closed.removeLast()
        }
        val wasCurrent = tab == current
        val other = when (tab) { current -> splitTab; splitTab -> current; else -> null }
        if (tab == current || tab == splitTab) leaveSplit(keep = other)
        val index = tabs.indexOf(tab)
        tabs.remove(tab)
        tab.webView?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        tab.webView = null
        tab.pageScript = null
        tabs.filter { it.parent == tab }.forEach { it.parent = tab.parent }
        if (wasCurrent) {
            current = null
            val back = tab.parent?.takeIf { it in tabs }
            val inSpace = tabs.filter { it.space == space }
            showTab(other ?: back ?: inSpace.getOrNull(index.coerceAtMost(inSpace.size - 1).coerceAtLeast(0)) ?: newTab())
        }
        if (tab.incognito && tabs.none { it.incognito }) wipePrivateData()
        updateBar()
    }

    private fun reopenClosed() {
        val (url, _) = closed.removeFirstOrNull() ?: return toast("No recently closed tabs")
        showTab(newTab(url))
    }

    // Wakes a sleeping tab by giving it a fresh WebView with its old history.
    private fun wake(tab: Tab): WebView {
        tab.webView?.let { return it }
        val wv = makeWebView(tab)
        tab.webView = wv
        val state = tab.savedState
        if (state == null || wv.restoreState(state) == null) wv.loadUrl(withoutAiOverview(Uri.parse(tab.url)) ?: tab.url)
        tab.savedState = null
        return wv
    }

    // Idea 8: tabs you aren't looking at go to sleep and free their memory.
    private fun sleep(tab: Tab) {
        if (tab == current || tab == splitTab) return
        val wv = tab.webView ?: return
        tab.savedState = Bundle().also { wv.saveState(it) }
        (wv.parent as? ViewGroup)?.removeView(wv)
        wv.destroy()
        tab.webView = null
        tab.pageScript = null
    }

    private val sleepCheck = object : Runnable {
        override fun run() {
            val saver = batterySaverOn()
            val minutes = prefs.getInt("sleepAfter", 5) // 0 = never
            val limit = if (saver) 60_000L else if (minutes == 0) Long.MAX_VALUE else minutes * 60_000L
            val keepAwake = if (saver) 1 else if (minutes == 0) Int.MAX_VALUE else 3
            val now = System.currentTimeMillis()
            tabs.filter { !it.asleep && it != current && it != splitTab }
                .sortedByDescending { it.lastUsed }
                .forEachIndexed { i, t -> if (i >= keepAwake || now - t.lastUsed > limit) sleep(t) }
            if (lookKey() != lookShown) refreshPages() // the theme schedule switched day/night
            val breakEvery = prefs.getInt("breakEvery", 0)
            if (breakEvery > 0 && !breakShowing && now - browsingSince > breakEvery * 60_000L) breakReminder(breakEvery)
            handler.postDelayed(this, 30_000)
        }
    }

    private fun saveTabs() {
        val normal = tabs.filter { !it.incognito }
        val list = JSONArray(normal.map { JSONObject().put("url", it.url).put("space", it.space).put("title", it.title) })
        prefs.edit().putString("tabs", list.toString())
            .putInt("current", normal.indexOf(current).coerceAtLeast(0))
            .putString("closed", JSONArray(closed.map { JSONObject().put("url", it.first).put("title", it.second) }).toString())
            .apply()
    }

    private fun restoreTabs() {
        val list = JSONArray(prefs.getString("tabs", "[]"))
        for (i in 0 until list.length()) {
            val item = list.get(i)
            if (item is JSONObject) newTab(item.optString("url", NEW_TAB)).apply {
                space = item.optString("space", "home")
                title = item.optString("title", "New Tab")
            }
            else newTab(item.toString()).space = "home" // saved by Aero 0.2.0
        }
        val old = JSONArray(prefs.getString("closed", "[]"))
        for (i in 0 until old.length()) old.getJSONObject(i).let { closed.addLast(it.getString("url") to it.getString("title")) }
        tabs.getOrNull(prefs.getInt("current", 0))?.let { showTab(it) }
    }

    // ================= Web viewer =================

    private fun makeWebView(tab: Tab): WebView {
        val wv = WebView(this)
        // Idea 3: private tabs get their own separate cookies and storage.
        if (tab.incognito) {
            ProfileStore.getInstance().getOrCreateProfile(INCOGNITO)
            WebViewCompat.setProfile(wv, INCOGNITO)
        }
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            builtInZoomControls = true
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
            allowFileAccess = false
            mediaPlaybackRequiresUserGesture = true
            if (tab.incognito) cacheMode = WebSettings.LOAD_NO_CACHE
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)
        // Pages can hand files they made themselves (like a Beat Lab recording) to the app to save.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(wv, "AeroNative", setOf("*")) { _, message, origin, isMainFrame, _ ->
                if (isMainFrame && message.type == WebMessageCompat.TYPE_STRING) onPageMessage(message.data ?: "", origin.toString(), tab)
            }
        }
        // Themes and Aero style go in before the page draws, so there's no flash of the plain site.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            tab.pageScript = WebViewCompat.addDocumentStartJavaScript(wv, pageScript, setOf("*"))
        }
        wv.webViewClient = PageClient(tab)
        wv.webChromeClient = ChromeClient(tab)
        wv.setDownloadListener { url, ua, disposition, mime, _ -> download(url, ua, disposition, mime) }
        // In split screen, touching a pane focuses its tab.
        wv.setOnTouchListener { _, e ->
            if (e.actionMasked == MotionEvent.ACTION_DOWN && tab == splitTab) showTab(tab)
            false
        }
        // Press and hold a link or picture for its menu.
        wv.setOnLongClickListener { pressAndHold(wv, tab) }
        return wv
    }

    private inner class PageClient(val tab: Tab) : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            assets.shouldInterceptRequest(request.url)?.let { return it }
            // Idea 6: ad blocker
            if (!request.isForMainFrame && adBlockOn(tab.pageHost) && AdBlock.blocks(request.url.host)) {
                tab.blocked++
                return WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
            }
            return null
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            return when (uri.scheme) {
                "http", "https" -> {
                    val fixed = withoutAiOverview(uri) ?: return false
                    view.loadUrl(fixed)
                    true
                }
                "blob", "data" -> false
                else -> { openOutside(uri); true }
            }
        }

        // A crashed page reloads itself instead of taking the whole app down.
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            if (tab.webView != view) { view.destroy(); return true }
            val pane = view.parent as? FrameLayout
            pane?.removeView(view)
            view.destroy()
            tab.webView = null
            tab.pageScript = null
            tab.savedState = null
            if (pane != null && (tab == current || tab == splitTab)) {
                pane.addView(wake(tab), FrameLayout.LayoutParams(-1, -1))
                if (tab == current) toast("That page crashed, so Aeris reloaded it")
            }
            return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            tab.url = url
            tab.pageHost = Uri.parse(url).host
            tab.blocked = 0
            if (tab == current) { progress.visibility = View.VISIBLE; updateBar() }
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
            tab.url = url
            tab.pageHost = Uri.parse(url).host
            if (tab == current) updateBar()
        }

        override fun onPageFinished(view: WebView, url: String) {
            if (tab == current) { progress.visibility = View.INVISIBLE; updateBar() }
            if (tab.pageScript == null) view.evaluateJavascript(pageScript, null) // older web viewers
            if (tab.filters.isNotEmpty()) view.evaluateJavascript("window.__aerisFilter && __aerisFilter(${JSONObject.quote(filterCss(tab.filters))})", null)
            if (!tab.incognito && (url.startsWith("http://") || url.startsWith("https://"))) remember(url, view.title ?: url)
            if (tab.isNewTab) {
                // The app's own battery saver (⋮ menu) is in charge here, so hide the page's switch for it.
                view.evaluateJavascript("(() => { const s = document.getElementById('setSaver')?.closest('section'); if (s) s.style.display = 'none'; })()", null)
                // Idea 9: the New Tab calms its bubbles and animations when battery saver is on.
                if (batterySaverOn()) {
                    view.evaluateJavascript("document.body.classList.add('saver'); if (typeof Bubbles !== 'undefined') Bubbles.stop();", null)
                }
            }
        }
    }

    private inner class ChromeClient(val tab: Tab) : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            if (tab == current) progress.progress = newProgress
        }

        override fun onConsoleMessage(message: android.webkit.ConsoleMessage): Boolean {
            android.util.Log.d("AeroPage", "${message.messageLevel()} ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
            return true
        }

        override fun onReceivedTitle(view: WebView, title: String?) {
            tab.title = if (tab.isNewTab) "New Tab" else title ?: tab.url
        }

        // Idea 1: videos go full screen
        override fun onShowCustomView(view: View, callback: CustomViewCallback) = enterFullscreen(view, callback)
        override fun onHideCustomView() = leaveFullscreen(fromPage = true)

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            return try {
                @Suppress("DEPRECATION")
                startActivityForResult(params.createIntent(), REQ_FILE)
                true
            } catch (e: Exception) {
                fileCallback = null
                false
            }
        }
    }

    @Deprecated("Uses the simple Activity result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
        }
        val file = data?.data
        if (resultCode != RESULT_OK) return
        when (requestCode) {
            REQ_IMPORT -> if (file != null) {
                val found = runCatching { contentResolver.openInputStream(file)!!.bufferedReader().use { BookmarkFile.read(it.readText()) } }.getOrNull()
                if (found == null) return toast("Couldn't read that file")
                val list = bookmarks()
                val added = found.filter { f -> list.none { it.first == f.first } }.distinctBy { it.first }
                saveBookmarks(list + added)
                toast(if (found.isEmpty()) "No bookmarks found in that file" else "Imported ${added.size} bookmarks")
            }
            REQ_EXPORT -> if (file != null) {
                val ok = runCatching { contentResolver.openOutputStream(file)!!.use { it.write(BookmarkFile.write(bookmarks()).toByteArray()) } }.isSuccess
                toast(if (ok) "Saved ${bookmarks().size} bookmarks" else "Couldn't save the file")
            }
            REQ_ROLE -> toast("Aeris is now your default browser 🎉")
        }
    }

    // Links like whatsapp:// or intent:// open the matching app.
    private fun openOutside(uri: Uri) {
        try {
            val intent = if (uri.scheme == "intent") {
                Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).apply {
                    addCategory(Intent.CATEGORY_BROWSABLE)
                    component = null
                    selector = null
                }
            } else Intent(Intent.ACTION_VIEW, uri)
            startActivity(intent)
        } catch (e: Exception) {
            val fallback = if (uri.scheme == "intent") {
                runCatching { Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url") }.getOrNull()
            } else null
            if (fallback != null) current?.webView?.loadUrl(fallback) else toast("No app on this phone can open that link")
        }
    }

    private fun download(url: String, ua: String, disposition: String?, mime: String?) {
        if (url.startsWith("data:")) return saveDataUrl(URLUtil.guessFileName(url, disposition, mime), url)
        if (url.startsWith("blob:")) {
            // Only the page that made it can read a blob, so ask the page to hand it over.
            val name = JSONObject.quote(URLUtil.guessFileName(url, disposition, mime))
            current?.webView?.evaluateJavascript(
                "fetch(${JSONObject.quote(url)}).then(r => r.blob()).then(b => { const f = new FileReader();" +
                " f.onload = () => AeroNative.postMessage(JSON.stringify({type: 'save', name: $name, data: f.result})); f.readAsDataURL(b); })" +
                ".catch(() => AeroNative.postMessage(JSON.stringify({type: 'save-failed'})))", null)
            return
        }
        try {
            val name = URLUtil.guessFileName(url, disposition, mime)
            val request = DownloadManager.Request(Uri.parse(url))
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                .addRequestHeader("User-Agent", ua)
            CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
            (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
            toast("Downloading $name")
        } catch (e: Exception) {
            toast("Couldn't download that file")
        }
    }

    // ================= Address bar and search =================

    private fun go(text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        val url = when {
            Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://").containsMatchIn(t) -> t
            !t.contains(' ') && t.contains('.') && !t.endsWith('.') -> "https://$t"
            else -> searchUrl() + Uri.encode(t)
        }
        val tab = current ?: return
        wake(tab).loadUrl(withoutAiOverview(Uri.parse(url)) ?: url)
        (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(address.windowToken, 0)
        column.requestFocus()
        updateBar()
    }

    // Idea 5: Google searches use the "Web" results view, which has no AI Overview box.
    private fun withoutAiOverview(uri: Uri): String? {
        if (!prefs.getBoolean("hideAi", true)) return null
        val host = uri.host ?: return null
        val google = host.startsWith("www.google.") || host.startsWith("google.")
        if (!google || uri.path != "/search") return null
        if (uri.getQueryParameter("udm") != null || uri.getQueryParameter("tbm") != null) return null
        return uri.buildUpon().appendQueryParameter("udm", "14").build().toString()
    }

    // ================= Ad blocker settings =================

    private fun allowedSites(): MutableSet<String> = prefs.getStringSet("adAllow", emptySet())!!.toMutableSet()

    private fun adBlockOn(host: String?): Boolean {
        if (!prefs.getBoolean("adBlock", true)) return false
        return host == null || host.removePrefix("www.") !in allowedSites()
    }

    private fun shieldDialog() {
        val tab = current ?: return
        val host = tab.pageHost?.removePrefix("www.")
        if (tab.isNewTab || host == null) return toast("The ad blocker works on websites")
        val on = adBlockOn(tab.pageHost)
        val msg = if (!prefs.getBoolean("adBlock", true)) "The ad blocker is switched off for every site (⋮ menu)."
        else if (on) "Blocked ${tab.blocked} ads and trackers on this page."
        else "The ad blocker is off for $host."
        AlertDialog.Builder(this).setTitle("🛡 Ad blocker").setMessage(msg)
            .setPositiveButton(if (on) "Turn off for $host" else "Turn on for $host") { _, _ ->
                val sites = allowedSites()
                if (on) sites.add(host) else sites.remove(host)
                prefs.edit().putStringSet("adAllow", sites).apply()
                tab.webView?.reload()
            }
            .setNegativeButton("Close", null).show()
    }

    // ================= Battery saver (idea 9) =================

    private fun batterySaverOn(): Boolean = when (prefs.getString("saver", "auto")) {
        "on" -> true
        "off" -> false
        else -> {
            val power = getSystemService(Context.POWER_SERVICE) as PowerManager
            val battery = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            power.isPowerSaveMode ||
                (!battery.isCharging && battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) in 1..20)
        }
    }

    private fun batterySaverDialog() {
        val modes = arrayOf("off", "on", "auto")
        val labels = arrayOf("Off", "On", "Automatic (when the phone's Battery Saver is on or battery is low)")
        val now = modes.indexOf(prefs.getString("saver", "auto"))
        AlertDialog.Builder(this).setTitle("🔋 Battery saver")
            .setSingleChoiceItems(labels, now) { d, i ->
                prefs.edit().putString("saver", modes[i]).apply()
                d.dismiss()
                toast(if (batterySaverOn()) "Battery saver is on: tabs sleep sooner" else "Battery saver is off")
            }.show()
    }

    // ================= Full-screen video (idea 1) =================

    private fun enterFullscreen(view: View, callback: WebChromeClient.CustomViewCallback) {
        if (customView != null) { callback.onCustomViewHidden(); return }
        customView = view
        customCallback = callback
        fullscreen.addView(view, FrameLayout.LayoutParams(-1, -1))
        fullscreen.visibility = View.VISIBLE
        systemBars(show = false)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }

    private fun leaveFullscreen(fromPage: Boolean) {
        val view = customView ?: return
        fullscreen.removeView(view)
        fullscreen.visibility = View.GONE
        customView = null
        if (!fromPage) customCallback?.onCustomViewHidden()
        customCallback = null
        systemBars(show = true)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }

    private fun systemBars(show: Boolean) {
        if (Build.VERSION.SDK_INT >= 30) {
            val c = window.insetsController ?: return
            if (show) c.show(WindowInsets.Type.systemBars())
            else {
                c.hide(WindowInsets.Type.systemBars())
                c.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (show) EDGE_TO_EDGE else
                (EDGE_TO_EDGE or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
        }
    }

    // ================= Split screen (idea 4) =================

    private fun enterSplit(withTab: Tab? = null) {
        if (splitTab != null) leaveSplit()
        val tab = current ?: return
        val other = withTab?.takeIf { it != tab } ?: tabs.filter { it != tab }.maxByOrNull { it.lastUsed } ?: newTab()
        splitTab = other
        other.lastUsed = System.currentTimeMillis()
        val wv = wake(other)
        (wv.parent as? ViewGroup)?.removeView(wv)
        val free = if (tab.webView?.parent == paneA) paneB else paneA
        free.removeAllViews()
        free.addView(wv, FrameLayout.LayoutParams(-1, -1))
        paneB.visibility = View.VISIBLE
        divider.visibility = View.VISIBLE
        wv.onResume()
        updateBar()
        toast("Split screen: tap a side to use it, drag the middle bar to resize")
    }

    // Leaves split screen, keeping one tab on screen.
    private fun leaveSplit(keep: Tab? = current) {
        val a = current ?: return
        val b = splitTab ?: return
        val gone = if (keep == b) a else b
        splitTab = null
        current = if (keep == b) b else a
        gone.webView?.let { it.onPause(); (it.parent as? ViewGroup)?.removeView(it) }
        gone.lastUsed = System.currentTimeMillis()
        val kept = current?.webView
        if (kept != null && kept.parent != paneA) {
            (kept.parent as? ViewGroup)?.removeView(kept)
            paneA.removeAllViews()
            paneA.addView(kept, FrameLayout.LayoutParams(-1, -1))
        }
        paneB.removeAllViews()
        paneB.visibility = View.GONE
        divider.visibility = View.GONE
        updateBar()
    }

    // ================= Private tabs (idea 3) =================

    private fun wipePrivateData() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) return
        val store = ProfileStore.getInstance()
        val profile = store.getProfile(INCOGNITO) ?: return
        profile.cookieManager.removeAllCookies(null)
        profile.webStorage.deleteAllData()
        // The profile can only be deleted once its pages have fully closed; the wipe above covers it otherwise.
        handler.postDelayed({ runCatching { if (tabs.none { it.incognito }) store.deleteProfile(INCOGNITO) } }, 1000)
    }

    // ================= Menu =================

    private fun showMenu(anchor: View) {
        val tab = current ?: return
        val popup = PopupMenu(this, anchor)
        val m = popup.menu
        val bookmarked = bookmarks().any { it.first == tab.url }
        val web = tab.url.startsWith("http")
        m.add(0, 1, 0, "New tab")
        m.add(0, 2, 0, "New private tab")
        m.add(0, 30, 0, "⚡ Quick Commands")
        m.add(0, 5, 0, if (bookmarked) "★ Remove bookmark" else "☆ Bookmark this page").isEnabled = !tab.url.startsWith(APP_PAGES)
        m.add(0, 6, 0, "Bookmarks…")
        m.add(0, 31, 0, "📝 Notes")
        m.add(0, 14, 0, "Downloads")
        m.add(0, 4, 0, "Recently closed…")
        m.add(0, 8, 0, if (splitTab != null) "Close split screen" else "Split screen")
        m.add(0, 7, 0, "Apps sidebar")
        m.add(0, 32, 0, "⛶ Focus mode")
        val more = m.addSubMenu(0, 0, 0, "More")
        more.add(0, 33, 0, "Clip this page to Notes").isEnabled = web
        more.add(0, 34, 0, "Hide something on this page").isEnabled = web
        more.add(0, 35, 0, "Show hidden things on this site").isEnabled = web && zaps().has(tab.pageHost?.removePrefix("www.") ?: "")
        more.add(0, 36, 0, "Page filters…").isEnabled = web
        more.add(0, 15, 0, "Aero Originals…")
        more.add(0, 9, 0, "Forward").isEnabled = tab.webView?.canGoForward() == true
        more.add(0, 10, 0, "Reload")
        val settings = m.addSubMenu(0, 0, 0, "Settings")
        settings.add(0, 16, 0, "Themes…")
        settings.add(0, 17, 0, "Search engine…")
        settings.add(0, 18, 0, "Address bar at the bottom").apply { isCheckable = true; isChecked = barAtBottom }
        settings.add(0, 19, 0, "Aero style on websites").apply { isCheckable = true; isChecked = prefs.getBoolean("aeroStyle", true) }
        settings.add(0, 12, 0, "Hide Google AI Overviews").apply { isCheckable = true; isChecked = prefs.getBoolean("hideAi", true) }
        settings.add(0, 13, 0, "Ad blocker").apply { isCheckable = true; isChecked = prefs.getBoolean("adBlock", true) }
        settings.add(0, 11, 0, "Battery saver…")
        settings.add(0, 37, 0, "Break reminders…")
        settings.add(0, 20, 0, "⚡ Power…")
        settings.add(0, 21, 0, "Make Aeris my default browser")
        settings.add(0, 38, 0, "Welcome tour")
        settings.add(0, 22, 0, "What's new")
        popup.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> showTab(newTab())
                2 -> newPrivateTab()
                4 -> recentlyClosedDialog()
                5 -> toggleBookmark(tab)
                6 -> bookmarksDialog()
                7 -> showApps()
                8 -> if (splitTab != null) leaveSplit() else enterSplit()
                9 -> tab.webView?.goForward()
                10 -> tab.webView?.reload()
                11 -> batterySaverDialog()
                12 -> { prefs.edit().putBoolean("hideAi", !item.isChecked).apply(); toast(if (!item.isChecked) "AI Overviews hidden" else "AI Overviews shown") }
                13 -> { prefs.edit().putBoolean("adBlock", !item.isChecked).apply(); tab.webView?.reload() }
                14 -> runCatching { startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS)) }.onFailure { toast("Open the Files app to see your Downloads") }
                15 -> originalsDialog()
                16 -> themesDialog()
                17 -> searchEngineDialog()
                18 -> { prefs.edit().putBoolean("barBottom", !item.isChecked).apply(); placeBar() }
                19 -> { prefs.edit().putBoolean("aeroStyle", !item.isChecked).apply(); refreshPages() }
                20 -> powerDialog()
                21 -> makeDefaultBrowser()
                22 -> whatsNew()
                30 -> quickCommands()
                31 -> showNotes()
                32 -> setFocus(true)
                33 -> clipPage(tab)
                34 -> pickToHide(tab)
                35 -> showHidden(tab)
                36 -> filtersDialog(tab)
                37 -> breakDialog()
                38 -> showWelcome()
                else -> return@setOnMenuItemClickListener false
            }
            true
        }
        popup.show()
    }

    // Keyboard shortcuts for tablets with a keyboard (idea 10: Ctrl+Shift+T).
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(event)
        val page = current?.webView
        val key = event.keyCode
        if (event.isCtrlPressed) {
            when {
                key == KeyEvent.KEYCODE_T && event.isShiftPressed -> { reopenClosed(); return true }
                key == KeyEvent.KEYCODE_T -> { showTab(newTab()); return true }
                key == KeyEvent.KEYCODE_N && event.isShiftPressed -> { newPrivateTab(); return true }
                key == KeyEvent.KEYCODE_W -> { current?.let { closeTab(it) }; return true }
                key == KeyEvent.KEYCODE_L -> { address.requestFocus(); return true }
                key == KeyEvent.KEYCODE_R -> { page?.reload(); return true }
                key == KeyEvent.KEYCODE_K -> { quickCommands(); return true }
                key == KeyEvent.KEYCODE_TAB -> {
                    val i = tabs.indexOf(current)
                    if (i >= 0 && tabs.size > 1) showTab(tabs[(i + (if (event.isShiftPressed) tabs.size - 1 else 1)) % tabs.size])
                    return true
                }
                key == KeyEvent.KEYCODE_EQUALS || key == KeyEvent.KEYCODE_PLUS || key == KeyEvent.KEYCODE_NUMPAD_ADD -> { page?.zoomIn(); return true }
                key == KeyEvent.KEYCODE_MINUS || key == KeyEvent.KEYCODE_NUMPAD_SUBTRACT -> { page?.zoomOut(); return true }
            }
        }
        when {
            key == KeyEvent.KEYCODE_ESCAPE && customView != null -> { leaveFullscreen(fromPage = false); return true }
            key == KeyEvent.KEYCODE_F5 -> { page?.reload(); return true }
            key == KeyEvent.KEYCODE_F2 -> { quickCommands(); return true }
            event.isAltPressed && event.isShiftPressed && key == KeyEvent.KEYCODE_F -> { setFocus(!focus); return true }
            event.isAltPressed && key == KeyEvent.KEYCODE_DPAD_LEFT -> { if (page?.canGoBack() == true) page.goBack(); return true }
            event.isAltPressed && key == KeyEvent.KEYCODE_DPAD_RIGHT -> { if (page?.canGoForward() == true) page.goForward(); return true }
        }
        return super.dispatchKeyEvent(event)
    }

    // ================= Bookmarks (idea 2: starts empty) =================

    private fun bookmarks(): List<Pair<String, String>> {
        val list = JSONArray(prefs.getString("bookmarks", "[]"))
        return (0 until list.length()).map { list.getJSONObject(it).let { o -> o.getString("url") to o.getString("title") } }
    }

    private fun saveBookmarks(list: List<Pair<String, String>>) {
        prefs.edit().putString("bookmarks", JSONArray(list.map { JSONObject().put("url", it.first).put("title", it.second) }).toString()).apply()
    }

    private fun toggleBookmark(tab: Tab) {
        val list = bookmarks().toMutableList()
        if (list.removeAll { it.first == tab.url }) toast("Bookmark removed")
        else { list.add(tab.url to tab.title); toast("Bookmarked ★") }
        saveBookmarks(list)
    }

    private fun bookmarksDialog() {
        val list = bookmarks()
        val dialog = AlertDialog.Builder(this).setTitle("★ Bookmarks")
        if (list.isEmpty()) dialog.setMessage("No bookmarks yet. Use ☆ in the menu to add one, or bring yours from another browser with Import.")
        else dialog.setItems(list.map { it.second }.toTypedArray()) { _, i -> go(list[i].first) }
        dialog.setPositiveButton("Import / export") { _, _ -> bookmarkTransferDialog() }
        if (list.isNotEmpty()) dialog.setNeutralButton("Remove…") { _, _ ->
            val pick = BooleanArray(list.size)
            AlertDialog.Builder(this).setTitle("Remove bookmarks")
                .setMultiChoiceItems(list.map { it.second }.toTypedArray(), pick) { _, i, on -> pick[i] = on }
                .setPositiveButton("Remove") { _, _ -> saveBookmarks(list.filterIndexed { i, _ -> !pick[i] }) }
                .setNegativeButton("Cancel", null).show()
        }
        dialog.setNegativeButton("Close", null).show()
    }

    // Bookmark transfer: the bookmarks file every browser can export and import.
    @Suppress("DEPRECATION")
    private fun bookmarkTransferDialog() {
        AlertDialog.Builder(this).setTitle("📚 Bring your bookmarks")
            .setMessage("From Aeris, Chrome, Edge or Opera GX on your computer: export your bookmarks there as a bookmarks file (.html), put the file on this phone (for example with Google Drive), then tap Import.\n\nExport saves your bookmarks as a file any browser can import.")
            .setPositiveButton("Import") { _, _ ->
                runCatching {
                    startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"), REQ_IMPORT)
                }.onFailure { toast("No file picker on this phone") }
            }
            .setNeutralButton("Export") { _, _ ->
                runCatching {
                    startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("text/html").putExtra(Intent.EXTRA_TITLE, "Aeris bookmarks.html"), REQ_EXPORT)
                }.onFailure { toast("No file picker on this phone") }
            }
            .setNegativeButton("Cancel", null).show()
    }

    private fun recentlyClosedDialog() {
        val list = closed.toList()
        if (list.isEmpty()) return toast("No recently closed tabs")
        AlertDialog.Builder(this).setTitle("Recently closed")
            .setItems(list.map { it.second }.toTypedArray()) { _, i ->
                closed.remove(list[i])
                showTab(newTab(list[i].first))
            }
            .setNegativeButton("Close", null).show()
    }

    // ================= Tabs panel =================

    private fun showTabsPanel() {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Gloss.shape(this@MainActivity, Gloss.GLASS, 22)
            setPadding(dp(14), dp(14), dp(14), dp(14))
        }
        card.addView(TextView(this).apply {
            text = "Tabs"
            textSize = 20f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Gloss.INK)
        })
        card.addView(TextView(this).apply {
            text = "+ opens a new tab under that one. Hold a tab to duplicate it, move it to a space, put it to sleep or split the screen."
            textSize = 12f
            setTextColor(0xFF2C5A80.toInt())
        })
        // Spaces: each one keeps its own tabs (like Aeris on the computer)
        val chips = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(8), 0, dp(2)) }
        for ((id, icon, name) in spaces()) {
            chips.addView(Gloss.pill(this, "$icon $name", if (id == space) Gloss.AQUA else Gloss.GLASS).apply {
                textSize = 13f
                setPadding(dp(12), dp(6), dp(12), dp(6))
                setOnClickListener { switchSpace(id); closeOverlay(); showTabsPanel() }
                setOnLongClickListener { spaceMenu(id, name); true }
            }, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(6) })
        }
        chips.addView(Gloss.orb(this, "+", Gloss.GREEN, 32).apply { setOnClickListener { addSpaceDialog() } }, LinearLayout.LayoutParams(dp(32), dp(32)))
        card.addView(HorizontalScrollView(this).apply { addView(chips); isHorizontalScrollBarEnabled = false })
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        for (tab in tabs.filter { it.space == space }) {
            val row = LinearLayout(this).apply {
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(12), dp(6), dp(6), dp(6))
                background = Gloss.shape(this@MainActivity, when {
                    tab == current -> Gloss.AQUA
                    tab.incognito -> Gloss.PRIVATE
                    else -> Gloss.GLASS
                }, 14)
                setOnClickListener { closeOverlay(); showTab(tab) }
                setOnLongClickListener { tabMenu(tab); true }
            }
            row.addView(TextView(this).apply {
                val badges = (if (tab.incognito) "🕶 " else "") + (if (tab.asleep) "💤 " else "") + (if (tab == splitTab) "◫ " else "")
                text = (if (tab.parent in tabs) "↳ " else "") + badges + tab.title
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
                textSize = 15f
                setTextColor(if (tab == current || tab.incognito) Color.WHITE else Gloss.INK)
            }, LinearLayout.LayoutParams(0, -2, 1f))
            row.addView(Gloss.orb(this, "+", Gloss.GREEN, 32).apply {
                textSize = 15f
                setOnClickListener { closeOverlay(); showTab(newTab(incognito = tab.incognito, under = tab)) }
            }, LinearLayout.LayoutParams(dp(32), dp(32)).apply { marginEnd = dp(6) })
            row.addView(Gloss.orb(this, "✕", Gloss.GREY, 32).apply {
                textSize = 13f
                setOnClickListener { closeTab(tab); closeOverlay(); showTabsPanel() }
            }, LinearLayout.LayoutParams(dp(32), dp(32)))
            list.addView(row, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8); if (tab.parent in tabs) marginStart = dp(18) })
        }
        card.addView(ScrollView(this).apply { addView(list) }, LinearLayout.LayoutParams(-1, 0, 1f))

        val buttons = LinearLayout(this).apply { gravity = Gravity.CENTER; setPadding(0, dp(12), 0, 0) }
        buttons.addView(Gloss.pill(this, "+ New tab", Gloss.GREEN).apply { setOnClickListener { closeOverlay(); showTab(newTab()) } })
        buttons.addView(Gloss.pill(this, "🕶 Private", Gloss.PRIVATE).apply { setOnClickListener { closeOverlay(); newPrivateTab() } },
            LinearLayout.LayoutParams(-2, -2).apply { marginStart = dp(8) })
        buttons.addView(Gloss.pill(this, "↺ Closed").apply { setOnClickListener { closeOverlay(); recentlyClosedDialog() } },
            LinearLayout.LayoutParams(-2, -2).apply { marginStart = dp(8) })
        card.addView(HorizontalScrollView(this).apply { addView(buttons); isHorizontalScrollBarEnabled = false })
        openOverlay(card)
    }

    private fun openOverlay(card: View) {
        closeOverlay()
        val scrim = FrameLayout(this).apply {
            setBackgroundColor(0x88003C78.toInt())
            setPadding(dp(12), insetTop + dp(12), dp(12), insetBottom + dp(12))
            setOnClickListener { closeOverlay() }
        }
        card.isClickable = true // taps on the card don't close it
        scrim.addView(card, FrameLayout.LayoutParams(minOf(resources.displayMetrics.widthPixels - dp(24), dp(520)), -1, Gravity.CENTER_HORIZONTAL))
        root.addView(scrim, FrameLayout.LayoutParams(-1, -1))
        overlay = scrim
    }

    private fun closeOverlay() {
        overlay?.let { root.removeView(it) }
        overlay = null
    }

    // ================= Apps sidebar (idea 7) =================

    private fun apps(): List<Pair<String, String>> {
        val saved = prefs.getString("apps", null)
            ?: """[{"title":"Discord","url":"https://discord.com/app"},{"title":"Spotify","url":"https://open.spotify.com"},{"title":"WhatsApp","url":"https://web.whatsapp.com"}]"""
        val list = JSONArray(saved)
        return (0 until list.length()).map { list.getJSONObject(it).let { o -> o.getString("title") to o.getString("url") } }
    }

    private fun saveApps(list: List<Pair<String, String>>) {
        prefs.edit().putString("apps", JSONArray(list.map { JSONObject().put("title", it.first).put("url", it.second) }).toString()).apply()
    }

    private fun showApps() {
        appsPanel?.let { root.removeView(it) }
        val panel = FrameLayout(this).apply {
            setBackgroundColor(0x66003C78)
            setPadding(0, insetTop, 0, insetBottom)
            setOnClickListener { visibility = View.GONE; appViews.values.forEach { it.onPause() } }
        }
        val wide = resources.displayMetrics.widthPixels > dp(700)
        val side = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            isClickable = true
            background = Gloss.shape(this@MainActivity, Gloss.AQUA, 0)
        }
        val chips = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(8), dp(8), dp(8), dp(8)) }
        val frame = FrameLayout(this).apply { setBackgroundColor(Color.WHITE) }
        val hint = TextView(this).apply {
            text = "Tap an app above. Hold an app to remove it."
            gravity = Gravity.CENTER
            setTextColor(Gloss.INK)
        }
        frame.addView(hint, FrameLayout.LayoutParams(-1, -1))

        fun open(url: String) {
            frame.removeAllViews()
            val wv = appViews.getOrPut(url) { makeAppView(url) }
            (wv.parent as? ViewGroup)?.removeView(wv)
            frame.addView(wv, FrameLayout.LayoutParams(-1, -1))
            wv.onResume()
        }
        for ((title, url) in apps()) {
            chips.addView(Gloss.pill(this, title).apply {
                setOnClickListener { open(url) }
                setOnLongClickListener {
                    AlertDialog.Builder(this@MainActivity).setMessage("Remove $title from the sidebar?")
                        .setPositiveButton("Remove") { _, _ ->
                            saveApps(apps().filter { it.second != url })
                            appViews.remove(url)?.destroy()
                            showApps()
                        }.setNegativeButton("Cancel", null).show()
                    true
                }
            }, LinearLayout.LayoutParams(-2, -2).apply { marginEnd = dp(6) })
        }
        chips.addView(Gloss.orb(this, "+", Gloss.GREEN, 36).apply { setOnClickListener { addAppDialog() } }, LinearLayout.LayoutParams(dp(36), dp(36)))
        side.addView(HorizontalScrollView(this).apply { addView(chips); isHorizontalScrollBarEnabled = false })
        side.addView(frame, LinearLayout.LayoutParams(-1, 0, 1f))

        val width = if (wide) (resources.displayMetrics.widthPixels * 0.5).toInt() else (resources.displayMetrics.widthPixels * 0.9).toInt()
        panel.addView(side, FrameLayout.LayoutParams(width, -1, Gravity.START))
        root.addView(panel, FrameLayout.LayoutParams(-1, -1))
        appsPanel = panel
    }

    // Apps open in their own web viewer that remembers sign-ins, and pretend to be a computer so
    // sites like WhatsApp Web load instead of saying "get the app".
    private fun makeAppView(url: String) = WebView(this).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.userAgentString = DESKTOP_UA
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
        val home = Uri.parse(url).host?.split('.')?.takeLast(2)?.joinToString(".") ?: ""
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                if (!request.isForMainFrame && prefs.getBoolean("adBlock", true) && AdBlock.blocks(request.url.host))
                    WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0))) else null

            // Links to other websites open as a normal tab.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.scheme != "http" && u.scheme != "https") { openOutside(u); return true }
                if (u.host?.endsWith(home) == true) return false
                appsPanel?.visibility = View.GONE
                showTab(newTab(u.toString()))
                return true
            }
        }
        webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View, callback: CustomViewCallback) = enterFullscreen(view, callback)
            override fun onHideCustomView() = leaveFullscreen(fromPage = true)
        }
        loadUrl(url)
    }

    private fun addAppDialog() {
        val input = EditText(this).apply {
            hint = "e.g. youtube.com"
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine()
        }
        AlertDialog.Builder(this).setTitle("Add an app").setMessage("Type the website of any app.")
            .setView(FrameLayout(this).apply { setPadding(dp(20), 0, dp(20), 0); addView(input) })
            .setPositiveButton("Add") { _, _ ->
                var url = input.text.toString().trim()
                if (url.isEmpty()) return@setPositiveButton
                if (!url.startsWith("http")) url = "https://$url"
                val host = Uri.parse(url).host?.removePrefix("www.") ?: return@setPositiveButton
                val name = host.substringBefore('.').replaceFirstChar { it.uppercase() }
                saveApps(apps() + (name to url))
                showApps()
            }.setNegativeButton("Cancel", null).show()
    }

    // ================= Tab menu (hold a tab in the tabs panel) =================

    private fun tabMenu(tab: Tab) {
        val items = mutableListOf<Pair<String, () -> Unit>>()
        items += "Duplicate" to { newTab(tab.url, tab.incognito); closeOverlay(); showTabsPanel() }
        if (tab != current && tab != splitTab) items += "Open in split screen" to { closeOverlay(); enterSplit(tab) }
        if (!tab.asleep && tab != current && tab != splitTab) items += "Put to sleep 💤" to { sleep(tab); closeOverlay(); showTabsPanel() }
        items += "Move to space…" to {
            val list = spaces()
            AlertDialog.Builder(this).setTitle("Move to space")
                .setItems(list.map { "${it.second} ${it.third}" }.toTypedArray()) { _, i ->
                    if (tab == splitTab || tab == current) leaveSplit()
                    tab.space = list[i].first
                    if (tab == current) showTab(tabs.firstOrNull { it.space == space && it != tab } ?: newTab())
                    closeOverlay()
                    showTabsPanel()
                }.show()
        }
        items += "Close" to { closeTab(tab); closeOverlay(); showTabsPanel() }
        AlertDialog.Builder(this).setTitle(tab.title)
            .setItems(items.map { it.first }.toTypedArray()) { _, i -> items[i].second() }
            .show()
    }

    // ================= Split screen divider =================

    // The bar between split panes: drag it to resize, double-tap it to make both sides equal again.
    private fun makeDivider() = FrameLayout(this).apply {
        background = Gloss.shape(this@MainActivity, Gloss.AQUA, 0, strokeColor = 0x66FFFFFF)
        visibility = View.GONE
        addView(View(this@MainActivity).apply { background = Gloss.shape(this@MainActivity, Gloss.GLASS, 999) },
            FrameLayout.LayoutParams(dp(48), dp(6), Gravity.CENTER))
        var lastTap = 0L
        setOnTouchListener { _, e ->
            val sideBySide = content.orientation == LinearLayout.HORIZONTAL
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    val now = System.currentTimeMillis()
                    if (now - lastTap < 300) { splitShare = 0.5f; layoutSplit() }
                    lastTap = now
                }
                MotionEvent.ACTION_MOVE -> {
                    val at = IntArray(2).also { content.getLocationOnScreen(it) }
                    val share = if (sideBySide) (e.rawX - at[0]) / content.width else (e.rawY - at[1]) / content.height
                    splitShare = share.coerceIn(0.2f, 0.8f)
                    layoutSplit()
                }
            }
            true
        }
    }

    // ================= Press and hold: link and picture menus =================

    private fun pressAndHold(wv: WebView, tab: Tab): Boolean {
        val hit = wv.hitTestResult
        val extra = hit.extra ?: return false
        when (hit.type) {
            WebView.HitTestResult.SRC_ANCHOR_TYPE -> linkMenu(extra, null, tab)
            WebView.HitTestResult.IMAGE_TYPE -> linkMenu(null, extra, tab)
            WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE -> {
                // A picture inside a link: ask the page for the link's address too.
                val reply = Handler(Looper.getMainLooper()) { m: Message -> linkMenu(m.data.getString("url"), extra, tab); true }
                wv.requestFocusNodeHref(reply.obtainMessage())
            }
            else -> return false
        }
        return true
    }

    private fun linkMenu(link: String?, image: String?, tab: Tab) {
        val items = mutableListOf<Pair<String, () -> Unit>>()
        val ua = tab.webView?.settings?.userAgentString ?: ""
        if (link != null) {
            items += "Open in new tab" to { showTab(newTab(link, tab.incognito, under = tab)) }
            items += "Open in background tab" to { newTab(link, tab.incognito); updateBar(); toast("Opened in a background tab") }
            items += "Open in split screen" to { enterSplit(newTab(link, tab.incognito)) }
            if (!tab.incognito) items += "Open in private tab" to { if (privateTabsWork()) showTab(newTab(link, true)) }
            items += "Clip to Aeris Notes" to { addNote(link, link, tab.title); toast("Clipped to Aeris Notes 📝") }
            items += "Copy link" to { copy(link) }
            items += "Share link" to { share(link) }
            items += "Download link" to { download(link, ua, null, null) }
        }
        if (image != null) {
            items += "Save image" to { saveImage(image, ua) }
            if (!image.startsWith("data:")) {
                items += "Open image in new tab" to { showTab(newTab(image, tab.incognito)) }
                items += "Copy image address" to { copy(image) }
            }
        }
        val title = link ?: if (image!!.startsWith("data:")) "Picture" else image
        AlertDialog.Builder(this).setTitle(title)
            .setItems(items.map { it.first }.toTypedArray()) { _, i -> items[i].second() }
            .show()
    }

    private fun saveImage(src: String, ua: String) {
        if (src.startsWith("data:")) return saveDataUrl("image", src)
        val ext = MimeTypeMap.getFileExtensionFromUrl(src)
        download(src, ua, null, MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "image/jpeg")
    }

    private fun copy(text: String) {
        (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("link", text))
        toast("Copied")
    }

    private fun share(text: String) =
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), null))

    // ================= Files pages make themselves =================

    private var lastSave = 0L

    private fun onPageMessage(json: String, origin: String, tab: Tab) {
        val msg = runCatching { JSONObject(json) }.getOrNull() ?: return
        when (msg.optString("type")) {
            // The welcome tour: only Aeris's own pages may change settings.
            "aeris" -> if (origin == APP_PAGES.removeSuffix("/assets/")) welcomeMessage(msg, tab)
            // "Hide something on this page": only right after you asked for it.
            "zap" -> if (zapPending) {
                zapPending = false
                val site = msg.optString("site")
                val selector = msg.optString("selector")
                if (site.isEmpty() || selector.isEmpty()) return
                val all = zaps()
                val list = all.optJSONArray(site) ?: JSONArray()
                list.put(selector)
                all.put(site, list)
                prefs.edit().putString("zaps", all.toString()).apply()
                refreshPages()
                toast("Hidden on $site. ⋮ → More → Show hidden things brings it back.")
            }
            "save" -> {
                // At most one file every 2 seconds, so a page can't flood Downloads.
                val now = System.currentTimeMillis()
                if (now - lastSave < 2000) return
                lastSave = now
                saveDataUrl(msg.optString("name", "download"), msg.optString("data"))
            }
            "save-failed" -> toast("Couldn't save that file")
        }
    }

    // Saves a data: address (a whole file written as text) into Downloads.
    private fun saveDataUrl(name: String, dataUrl: String) {
        val comma = dataUrl.indexOf(',')
        if (!dataUrl.startsWith("data:") || comma < 0) return toast("Couldn't save that file")
        val head = dataUrl.substring(5, comma)
        val mime = head.substringBefore(';').ifEmpty { "application/octet-stream" }
        val bytes = runCatching {
            val body = dataUrl.substring(comma + 1)
            if (head.endsWith(";base64")) Base64.decode(body, Base64.DEFAULT) else Uri.decode(body).toByteArray()
        }.getOrNull() ?: return toast("Couldn't save that file")
        if (bytes.size > 100 * 1024 * 1024) return toast("That file is too big to save")
        var fileName = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifEmpty { "download" }
        if (!fileName.contains('.')) MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)?.let { fileName += ".$it" }
        try {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IllegalStateException()
            contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            contentResolver.update(uri, values, null, null)
            toast("Saved $fileName to Downloads")
        } catch (e: Exception) {
            toast("Couldn't save that file")
        }
    }

    // ================= Themes =================

    private fun themesDialog() {
        val custom = Themes.get(this, prefs.getString("theme", ""))?.name ?: "none"
        val colour = if (prefs.getString("colorTheme", "frost") == "studio") "Your own look"
            else Themes.COLORS.find { it.id == prefs.getString("colorTheme", "frost") }?.name ?: "Frost"
        AlertDialog.Builder(this).setTitle("✨ Themes")
            .setItems(arrayOf(
                "🎨 Colour: $colour",
                "✨ Custom theme: $custom",
                "🖌️ Theme Studio: make your own look",
                "🌗 Day and night themes: ${if (prefs.getBoolean("scheduleOn", false)) "on" else "off"}",
            )) { _, i ->
                when (i) {
                    0 -> colourDialog("colorTheme")
                    1 -> customThemeDialog("theme")
                    2 -> studioDialog()
                    3 -> scheduleDialog()
                }
            }.show()
    }

    // Picks a colour theme for the day look ("colorTheme") or the night look ("nightColor").
    private fun colourDialog(key: String) {
        val ids = Themes.COLORS.map { it.id } + "studio"
        val names = Themes.COLORS.map { it.name } + "Your own look (Theme Studio)"
        val now = ids.indexOf(prefs.getString(key, if (key == "nightColor") "midnight" else "frost"))
        AlertDialog.Builder(this).setTitle("🎨 Colours")
            .setSingleChoiceItems(names.toTypedArray(), now) { d, i ->
                prefs.edit().putString(key, ids[i]).apply()
                d.dismiss()
                refreshPages()
            }.show()
    }

    private fun customThemeDialog(key: String) {
        val list = Themes.list(this)
        val now = list.indexOfFirst { it.id == prefs.getString(key, "") } + 1
        AlertDialog.Builder(this).setTitle("✨ Custom theme")
            .setSingleChoiceItems((listOf("No custom theme · just the colours") + list.map { "${it.name} · ${it.description}" }).toTypedArray(), now) { d, i ->
                prefs.edit().putString(key, if (i == 0) "" else list[i - 1].id).apply()
                d.dismiss()
                refreshPages()
            }
            .setNegativeButton("Close", null).show()
    }

    // ================= Theme Studio: your own look without code =================

    private val SWATCHES = longArrayOf(
        0xFF1F7FD6, 0xFF7FD0FF, 0xFF0B6FB5, 0xFF031F45, 0xFF2F8F3F, 0xFFA8E66B, 0xFF3CB83C, 0xFF00A88F,
        0xFFD0287F, 0xFFFFB3E0, 0xFFFF5FB0, 0xFF7B3FD6, 0xFFE8601A, 0xFFFFD27A, 0xFFFF8C1A, 0xFFD62828,
        0xFF7A8B9A, 0xFFE6EEF4, 0xFF0B0F1E, 0xFF26324F, 0xFF4A2E17, 0xFFFBF1D6, 0xFFFAFAFA, 0xFF222222,
    ).map { it.toInt() }.toIntArray()

    private fun studioDialog() {
        val glossNames = arrayOf("No shine (flat)", "A little shine", "Lots of shine")
        val glossValues = floatArrayOf(0f, 0.5f, 0.9f)
        val g = glossValues.indexOfFirst { it >= prefs.getFloat("studioGloss", 0.9f) - 0.01f }.coerceAtLeast(0)
        AlertDialog.Builder(this).setTitle("🖌️ Theme Studio")
            .setItems(arrayOf("Top colour…", "Bottom colour…", "Button colour…", "Shine: ${glossNames[g]}", "✓ Use my look")) { _, i ->
                when (i) {
                    0 -> pickColor("Top colour", "studioA")
                    1 -> pickColor("Bottom colour", "studioB")
                    2 -> pickColor("Button colour", "studioAccent")
                    3 -> AlertDialog.Builder(this).setTitle("Shine").setSingleChoiceItems(glossNames, g) { d, j ->
                        prefs.edit().putFloat("studioGloss", glossValues[j]).apply()
                        d.dismiss()
                        studioDialog()
                    }.show()
                    4 -> {
                        prefs.edit().putString("colorTheme", "studio").putString("theme", "").apply()
                        refreshPages()
                        toast("Using your own look ✨")
                    }
                }
            }.show()
    }

    private fun pickColor(title: String, key: String) {
        val grid = android.widget.GridLayout(this).apply { columnCount = 6; setPadding(dp(16), dp(8), dp(16), dp(8)) }
        lateinit var dialog: AlertDialog
        for (color in SWATCHES) {
            grid.addView(View(this).apply {
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(color)
                    setStroke(dp(if (prefs.getInt(key, 0) == color) 4 else 1), if (prefs.getInt(key, 0) == color) Gloss.INK else 0x55000000)
                }
                setOnClickListener {
                    prefs.edit().putInt(key, color).apply()
                    if (prefs.getString("colorTheme", "") == "studio") refreshPages()
                    dialog.dismiss()
                    studioDialog()
                }
            }, android.widget.GridLayout.LayoutParams().apply { width = dp(40); height = dp(40); setMargins(dp(4), dp(4), dp(4), dp(4)) })
        }
        dialog = AlertDialog.Builder(this).setTitle(title).setView(grid).setNegativeButton("Back") { _, _ -> studioDialog() }.show()
    }

    // ================= Theme schedule: a day look and a night look =================

    private fun scheduleDialog() {
        val on = prefs.getBoolean("scheduleOn", false)
        val nightColour = Themes.COLORS.find { it.id == prefs.getString("nightColor", "midnight") }?.name ?: "Your own look"
        val nightCustom = Themes.get(this, prefs.getString("nightTheme", ""))?.name ?: "none"
        AlertDialog.Builder(this).setTitle("🌗 Day and night themes")
            .setMessage("Your normal look from 7 am, and a night look from 7 pm. They switch on their own.\n\nNight colour: $nightColour\nNight custom theme: $nightCustom")
            .setPositiveButton(if (on) "Turn off" else "Turn on") { _, _ ->
                prefs.edit().putBoolean("scheduleOn", !on).apply()
                refreshPages()
            }
            .setNeutralButton("Night colour…") { _, _ -> colourDialog("nightColor") }
            .setNegativeButton("Night theme…") { _, _ -> customThemeDialog("nightTheme") }
            .show()
    }

    // Rebuilds the page script after a setting changes and gives it to every open page.
    private fun refreshPages() {
        pageScript = Themes.pageScript(this, customTheme, prefs.getBoolean("aeroStyle", true), zaps())
        lookShown = lookKey()
        val startScripts = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        for (tab in tabs) {
            val wv = tab.webView ?: continue
            tab.pageScript?.remove()
            tab.pageScript = if (startScripts) WebViewCompat.addDocumentStartJavaScript(wv, pageScript, setOf("*")) else null
            wv.evaluateJavascript(pageScript, null)
        }
        updateBar()
    }

    // ================= Search engine =================

    private val engines = listOf(
        Triple("google", "Google", "https://www.google.com/search?q="),
        Triple("bing", "Bing", "https://www.bing.com/search?q="),
        Triple("duckduckgo", "DuckDuckGo", "https://duckduckgo.com/?q="),
        Triple("brave", "Brave Search", "https://search.brave.com/search?q="),
        Triple("ecosia", "Ecosia", "https://www.ecosia.org/search?q="),
    )

    private fun searchUrl() = (engines.find { it.first == prefs.getString("engine", "google") } ?: engines[0]).third

    private fun searchEngineDialog() {
        val now = engines.indexOfFirst { it.first == prefs.getString("engine", "google") }.coerceAtLeast(0)
        AlertDialog.Builder(this).setTitle("🔍 Search engine")
            .setSingleChoiceItems(engines.map { it.second }.toTypedArray(), now) { d, i ->
                prefs.edit().putString("engine", engines[i].first).apply()
                d.dismiss()
                toast("Searching with ${engines[i].second}")
            }.show()
    }

    // ================= Power =================

    private fun powerDialog() {
        val awake = tabs.count { !it.asleep }
        val aeroMb = android.os.Debug.MemoryInfo().also { android.os.Debug.getMemoryInfo(it) }.totalPss / 1024
        val phone = android.app.ActivityManager.MemoryInfo().also { (getSystemService(ACTIVITY_SERVICE) as android.app.ActivityManager).getMemoryInfo(it) }
        val minutes = prefs.getInt("sleepAfter", 5)
        val sleepText = if (minutes == 0) "never" else "after $minutes min"
        AlertDialog.Builder(this).setTitle("⚡ Power")
            .setMessage("Aeris: about $aeroMb MB (web pages can use a bit more)\n" +
                "Phone memory free: ${phone.availMem / 1_048_576} of ${phone.totalMem / 1_048_576} MB\n" +
                "Tabs: $awake awake, ${tabs.size - awake} asleep 💤\n" +
                "Unused tabs sleep: $sleepText\n" +
                "Battery saver: ${if (batterySaverOn()) "on" else "off"}")
            .setPositiveButton("Sleep other tabs now") { _, _ ->
                tabs.filter { it != current && it != splitTab }.forEach { sleep(it) }
                toast("Other tabs are asleep 💤")
            }
            .setNeutralButton("Sleep tabs after…") { _, _ ->
                val choices = intArrayOf(1, 5, 15, 30, 0)
                AlertDialog.Builder(this).setTitle("Put unused tabs to sleep")
                    .setSingleChoiceItems(arrayOf("After 1 minute", "After 5 minutes", "After 15 minutes", "After 30 minutes", "Never"),
                        choices.indexOf(minutes)) { d, i ->
                        prefs.edit().putInt("sleepAfter", choices[i]).apply()
                        d.dismiss()
                    }.show()
            }
            .setNegativeButton("Close", null).show()
    }

    // ================= Default browser =================

    @Suppress("DEPRECATION")
    private fun makeDefaultBrowser() {
        val roles = getSystemService(RoleManager::class.java)
        if (roles != null && roles.isRoleAvailable(RoleManager.ROLE_BROWSER)) {
            if (roles.isRoleHeld(RoleManager.ROLE_BROWSER)) return toast("Aeris is already your default browser 🎉")
            startActivityForResult(roles.createRequestRoleIntent(RoleManager.ROLE_BROWSER), REQ_ROLE)
        } else {
            runCatching { startActivity(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)) }
                .onFailure { toast("Open Settings → Apps → Default apps → Browser app") }
        }
    }

    // ================= Aero Originals =================

    private fun originalsDialog() {
        AlertDialog.Builder(this).setTitle("✨ Aero Originals")
            .setItems(arrayOf(
                "🎧 Beat Lab: drum machine, two DJ decks, BPM sync, a recorder and lessons",
                "🎒 School Assist: on the computer version only, for now",
            )) { _, i ->
                if (i == 0) showTab(newTab(APP_PAGES + "originals/beat-lab/app.html"))
                else AlertDialog.Builder(this).setTitle("🎒 School Assist")
                    .setMessage("School Assist reads the 21K School website as you use it, which needs browser extensions. Phones can't run those yet, so it's only in Aeris on your computer for now.")
                    .setPositiveButton("OK", null).show()
            }.show()
    }

    // ================= What's new =================

    private fun whatsNew() {
        AlertDialog.Builder(this).setTitle("✨ What's new: Aeris $VERSION")
            .setMessage(listOf(
                "🦊 Aero is now Aeris, like on the computer: the same name, colours and features, made for your phone.",
                "🎨 Aeris's 8 colour themes plus Minimal, with any custom theme on top. Make your own in 🖌️ Theme Studio, and switch looks for day and night on their own (⋮ → Settings → Themes).",
                "⚡ Quick Commands (⋮, or F2 with a keyboard): find any tab, bookmark or page you visited, do quick maths, or run a command like \"Theme: Sunset\".",
                "📝 Notes: write notes, clip links (press and hold a link) or a whole page.",
                "🗂️ Spaces: keep School, Games and Music tabs apart. Switch at the top of the tabs list.",
                "⛶ Focus mode hides the bar. Tap ⛶ to bring it back.",
                "🙈 Hide something annoying on a website (⋮ → More), and 🌗 page filters: grayscale, dark, sepia and more.",
                "🗂️ Tab stacking: + on a tab opens a new tab under it, and closing it takes you back.",
                "🌿 Break reminders, and a welcome tour to set everything up (⋮ → Settings).",
            ).joinToString("\n\n"))
            .setPositiveButton("Cool!", null).show()
    }

    // ================= Welcome tour (shared with the home-screen web app: app/welcome) =================

    private fun showWelcome() {
        val roles = getSystemService(RoleManager::class.java)
        val isDefault = roles?.isRoleHeld(RoleManager.ROLE_BROWSER) == true
        val bit = { key: String, default: Boolean -> if (prefs.getBoolean(key, default)) "1" else "0" }
        val url = APP_PAGES + "welcome/index.html?app=android" +
            "&colorTheme=" + Uri.encode(prefs.getString("colorTheme", "frost")) +
            "&theme=" + Uri.encode(prefs.getString("theme", "")) +
            "&adBlock=" + bit("adBlock", true) + "&hideAi=" + bit("hideAi", true) + "&aeroStyle=" + bit("aeroStyle", true) +
            "&isDefault=" + (if (isDefault) "1" else "0")
        // Reuse a tour that's already open (say, Aeris was closed halfway through it)
        showTab(tabs.firstOrNull { it.url.startsWith(APP_PAGES + "welcome/") } ?: newTab(url))
    }

    @Suppress("DEPRECATION")
    private fun welcomeMessage(msg: JSONObject, tab: Tab) {
        when (msg.optString("action")) {
            "set" -> {
                val key = msg.optString("key")
                when (key) {
                    "colorTheme" -> prefs.edit().putString("colorTheme", msg.optString("value", "frost")).apply()
                    "theme" -> prefs.edit().putString("theme", if (msg.isNull("value")) "" else msg.optString("value")).apply()
                    "adBlock", "hideAi", "aeroStyle" -> prefs.edit().putBoolean(key, msg.optBoolean("value")).apply()
                    else -> return
                }
                if (key == "colorTheme" || key == "theme" || key == "aeroStyle") refreshPages()
            }
            "import" -> runCatching {
                startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"), REQ_IMPORT)
            }
            "default" -> makeDefaultBrowser()
            "finish" -> {
                prefs.edit().putBoolean("welcomed", true).apply()
                tab.webView?.loadUrl(NEW_TAB)
            }
        }
    }

    // ================= Spaces =================

    private fun spaces(): List<Triple<String, String, String>> {
        val saved = prefs.getString("spaces", null)
            ?: """[{"id":"home","icon":"🏠","name":"Home"},{"id":"school","icon":"🎒","name":"School"},{"id":"games","icon":"🎮","name":"Games"},{"id":"music","icon":"🎵","name":"Music"}]"""
        val list = JSONArray(saved)
        return (0 until list.length()).map { list.getJSONObject(it).let { o -> Triple(o.getString("id"), o.getString("icon"), o.getString("name")) } }
    }

    private fun saveSpaces(list: List<Triple<String, String, String>>) {
        prefs.edit().putString("spaces", JSONArray(list.map { JSONObject().put("id", it.first).put("icon", it.second).put("name", it.third) }).toString()).apply()
    }

    private fun switchSpace(id: String) {
        if (id == space) return
        if (splitTab != null) leaveSplit()
        space = id
        prefs.edit().putString("space", id).apply()
        showTab(tabs.filter { it.space == id }.maxByOrNull { it.lastUsed } ?: newTab())
        toast("Space: " + (spaces().find { it.first == id }?.let { "${it.second} ${it.third}" } ?: id))
    }

    private fun addSpaceDialog() {
        val input = EditText(this).apply { hint = "e.g. Homework"; setSingleLine() }
        AlertDialog.Builder(this).setTitle("New space")
            .setView(FrameLayout(this).apply { setPadding(dp(20), 0, dp(20), 0); addView(input) })
            .setPositiveButton("Add") { _, _ ->
                val name = input.text.toString().trim().ifEmpty { return@setPositiveButton }
                val icons = listOf("⭐", "📚", "🎨", "⚽", "🧪", "🍿", "💼", "🌍")
                val list = spaces()
                saveSpaces(list + Triple("s" + System.currentTimeMillis(), icons[list.size % icons.size], name))
                closeOverlay()
                showTabsPanel()
            }.setNegativeButton("Cancel", null).show()
    }

    private fun spaceMenu(id: String, name: String) {
        if (id == "home") return toast("Home is always here")
        AlertDialog.Builder(this).setTitle(name)
            .setMessage("Remove this space? Its tabs move to Home.")
            .setPositiveButton("Remove") { _, _ ->
                tabs.filter { it.space == id }.forEach { it.space = "home" }
                saveSpaces(spaces().filter { it.first != id })
                if (space == id) { space = "home"; prefs.edit().putString("space", "home").apply() }
                closeOverlay()
                showTabsPanel()
                updateBar()
            }.setNegativeButton("Cancel", null).show()
    }

    // ================= Notes =================

    private fun notes(): MutableList<JSONObject> {
        val list = runCatching { JSONArray(prefs.getString("notes", "[]")) }.getOrDefault(JSONArray())
        return (0 until list.length()).map { list.getJSONObject(it) }.toMutableList()
    }

    private fun saveNotes(list: List<JSONObject>) = prefs.edit().putString("notes", JSONArray(list).toString()).apply()

    private fun addNote(text: String, url: String?, title: String?) {
        saveNotes(listOf(JSONObject().put("text", text).put("url", url ?: "").put("title", title ?: "").put("time", System.currentTimeMillis())) + notes())
    }

    private fun showNotes() {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Gloss.shape(this@MainActivity, Gloss.GLASS, 22)
            setPadding(dp(14), dp(14), dp(14), dp(14))
        }
        card.addView(TextView(this).apply { text = "📝 Notes"; textSize = 20f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Gloss.INK) })
        val input = EditText(this).apply {
            hint = "Write a note…"
            minLines = 2
            setTextColor(Gloss.INK)
            background = Gloss.shape(this@MainActivity, intArrayOf(-1, -1, 0xFFF4FBFF.toInt(), 0xFFF4FBFF.toInt()), 14, strokeColor = 0xFF9CCBE8.toInt())
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        card.addView(input, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
        card.addView(Gloss.pill(this, "+ Add note", Gloss.GREEN).apply {
            setOnClickListener {
                val text = input.text.toString().trim()
                if (text.isNotEmpty()) { addNote(text, null, null); closeOverlay(); showNotes() }
            }
        }, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(8); gravity = Gravity.END })
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val all = notes()
        if (all.isEmpty()) list.addView(TextView(this).apply {
            text = "No notes yet. Press and hold a link → Clip to Aeris Notes, or ⋮ → More → Clip this page."
            setTextColor(0xFF2C5A80.toInt())
            setPadding(0, dp(12), 0, 0)
        })
        for (note in all) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(12), dp(8), dp(12), dp(8))
                background = Gloss.shape(this@MainActivity, Gloss.GLASS, 14)
                val url = note.optString("url")
                if (url.isNotEmpty()) setOnClickListener { closeOverlay(); showTab(newTab(url)) }
                setOnLongClickListener {
                    AlertDialog.Builder(this@MainActivity).setItems(arrayOf("Copy", "Delete")) { _, i ->
                        if (i == 0) copy(note.optString("text") + if (url.isNotEmpty()) "\n$url" else "")
                        else { saveNotes(notes().filter { it.optLong("time") != note.optLong("time") }); closeOverlay(); showNotes() }
                    }.show()
                    true
                }
            }
            row.addView(TextView(this).apply { text = note.optString("text"); setTextColor(Gloss.INK); textSize = 15f; maxLines = 6 })
            val from = note.optString("title").ifEmpty { note.optString("url") }
            if (from.isNotEmpty()) row.addView(TextView(this).apply {
                text = "🔗 $from"
                textSize = 12f
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
                setTextColor(0xFF1E7FC8.toInt())
            })
            list.addView(row, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        }
        card.addView(ScrollView(this).apply { addView(list) }, LinearLayout.LayoutParams(-1, 0, 1f))
        openOverlay(card)
    }

    // Clips what you selected on the page (or just the page itself) with a link back.
    private fun clipPage(tab: Tab) {
        val wv = tab.webView ?: return
        wv.evaluateJavascript("getSelection().toString()") { value ->
            val selected = runCatching { JSONArray("[$value]").getString(0) }.getOrDefault("").trim()
            addNote(selected.ifEmpty { "📄 " + tab.title }, tab.url, tab.title)
            toast("Clipped to Aeris Notes 📝")
        }
    }

    // ================= Focus mode =================

    private fun setFocus(on: Boolean) {
        if (focus == on) return
        focus = on
        focusOrb?.let { root.removeView(it) }
        focusOrb = null
        if (on) {
            focusOrb = Gloss.orb(this, "⛶", look.orbs, 36).apply {
                alpha = 0.75f
                setOnClickListener { setFocus(false) }
            }
            // Bottom corner, where pages rarely have buttons
            root.addView(focusOrb, FrameLayout.LayoutParams(dp(36), dp(36), Gravity.BOTTOM or Gravity.END).apply {
                bottomMargin = insetBottom + dp(14)
                marginEnd = dp(12)
            })
            if (!prefs.getBoolean("focusTold", false)) {
                prefs.edit().putBoolean("focusTold", true).apply()
                toast("Focus mode: tap ⛶ (or Back) to bring the bar back")
            }
        }
        placeBar()
    }

    // ================= Hide this on the website =================

    private fun pickToHide(tab: Tab) {
        zapPending = true
        tab.webView?.evaluateJavascript("window.__aerisPick && __aerisPick()", null)
    }

    private fun showHidden(tab: Tab) {
        val site = tab.pageHost?.removePrefix("www.") ?: return
        val all = zaps()
        all.remove(site)
        prefs.edit().putString("zaps", all.toString()).apply()
        refreshPages()
        tab.webView?.reload()
        toast("Everything you hid on $site is back")
    }

    // ================= Page filters (the same as Aeris on the computer) =================

    private val PAGE_FILTERS = linkedMapOf(
        "grayscale" to Triple("Grayscale", "grayscale(1)", ""),
        "dark" to Triple("Dark (inverted)", "invert(0.92) hue-rotate(180deg)",
            "img, video, picture, canvas, iframe, svg image, [style*='background-image'] { filter: invert(1) hue-rotate(180deg) !important; }"),
        "sepia" to Triple("Sepia", "sepia(0.75)", ""),
        "contrast" to Triple("High contrast", "contrast(1.4)", ""),
        "noimages" to Triple("No images", "", "img, picture, video, [style*='background-image'] { visibility: hidden !important; }"),
        "readable" to Triple("Readable font", "", "body, body *:not(code):not(pre):not(kbd) { font-family: Georgia, 'Palatino Linotype', serif !important; line-height: 1.7 !important; }"),
    )

    private fun filterCss(list: List<String>): String {
        val filters = list.mapNotNull { PAGE_FILTERS[it]?.second?.ifEmpty { null } }
        val parts = list.mapNotNull { PAGE_FILTERS[it]?.third?.ifEmpty { null } }.toMutableList()
        if (filters.isNotEmpty()) parts.add(0, "html { filter: ${filters.joinToString(" ")} !important; }")
        return parts.joinToString("\n")
    }

    private fun applyFilters(tab: Tab) {
        tab.webView?.evaluateJavascript("window.__aerisFilter && __aerisFilter(${JSONObject.quote(filterCss(tab.filters))})", null)
    }

    private fun filtersDialog(tab: Tab) {
        val ids = PAGE_FILTERS.keys.toList()
        val on = BooleanArray(ids.size) { ids[it] in tab.filters }
        AlertDialog.Builder(this).setTitle("🌗 Page filters for this tab")
            .setMultiChoiceItems(ids.map { PAGE_FILTERS[it]!!.first }.toTypedArray(), on) { _, i, checked -> on[i] = checked }
            .setPositiveButton("Done") { _, _ ->
                tab.filters.clear()
                tab.filters.addAll(ids.filterIndexed { i, _ -> on[i] })
                applyFilters(tab)
            }
            .setNeutralButton("All off") { _, _ -> tab.filters.clear(); applyFilters(tab) }
            .show()
    }

    // ================= Break reminders =================

    private fun breakDialog() {
        val choices = intArrayOf(0, 20, 30, 45, 60)
        AlertDialog.Builder(this).setTitle("🌿 Break reminders")
            .setSingleChoiceItems(arrayOf("Off", "Every 20 minutes", "Every 30 minutes", "Every 45 minutes", "Every hour"),
                choices.indexOf(prefs.getInt("breakEvery", 0)).coerceAtLeast(0)) { d, i ->
                prefs.edit().putInt("breakEvery", choices[i]).apply()
                browsingSince = System.currentTimeMillis()
                d.dismiss()
            }.show()
    }

    private fun breakReminder(minutes: Int) {
        breakShowing = true
        AlertDialog.Builder(this).setTitle("🌿 Time for a break")
            .setMessage("You've been browsing for $minutes minutes. Look at something far away for 20 seconds, stretch, and have some water.")
            .setPositiveButton("Done") { _, _ -> }
            .setOnDismissListener { breakShowing = false; browsingSince = System.currentTimeMillis() }
            .show()
    }

    // ================= History (for Quick Commands) =================

    private fun remember(url: String, title: String) {
        history.removeAll { it.first == url }
        history.addFirst(url to title)
        while (history.size > 300) history.removeLast()
    }

    private fun loadHistory() {
        val list = runCatching { JSONArray(prefs.getString("history", "[]")) }.getOrDefault(JSONArray())
        for (i in 0 until list.length()) list.getJSONObject(i).let { history.addLast(it.getString("url") to it.optString("title")) }
    }

    private fun saveHistory() {
        prefs.edit().putString("history", JSONArray(history.map { JSONObject().put("url", it.first).put("title", it.second) }).toString()).apply()
    }

    // ================= Quick Commands =================
    // One box to find any open tab, bookmark or page you visited, do quick maths, or run a command.

    private fun commands(): List<Pair<String, () -> Unit>> {
        val tab = current
        val list = mutableListOf<Pair<String, () -> Unit>>(
            "➕ New tab" to { showTab(newTab()) },
            "🕶 New private tab" to { newPrivateTab() },
            "↩️ Reopen closed tab" to { reopenClosed() },
            "📝 Notes" to { showNotes() },
            "◫ Split screen" to { if (splitTab != null) leaveSplit() else enterSplit() },
            "⛶ Focus mode" to { setFocus(!focus) },
            "★ Bookmarks" to { bookmarksDialog() },
            "⬇️ Downloads" to { runCatching { startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS)) } },
            "✨ Themes" to { themesDialog() },
            "🖌️ Theme Studio" to { studioDialog() },
            "🔋 Battery saver" to { batterySaverDialog() },
            "🎧 Beat Lab" to { showTab(newTab(APP_PAGES + "originals/beat-lab/app.html")) },
        )
        if (tab != null && tab.url.startsWith("http")) {
            list += "📝 Clip this page to Notes" to { clipPage(tab) }
            list += "🙈 Hide something on this page" to { pickToHide(tab) }
            list += "🌗 Page filters off" to { tab.filters.clear(); applyFilters(tab) }
            for ((id, f) in PAGE_FILTERS) list += "🌗 Page filter: ${f.first}" to { if (id !in tab.filters) tab.filters.add(id); applyFilters(tab) }
        }
        for (c in Themes.COLORS) list += "🎨 Theme: ${c.name}" to { prefs.edit().putString("colorTheme", c.id).apply(); refreshPages() }
        list += "🎨 Theme: Your own look" to { prefs.edit().putString("colorTheme", "studio").putString("theme", "").apply(); refreshPages() }
        for (t in Themes.list(this)) list += "✨ Custom theme: ${t.name}" to { prefs.edit().putString("theme", t.id).apply(); refreshPages() }
        list += "✨ Custom theme: none" to { prefs.edit().putString("theme", "").apply(); refreshPages() }
        for ((id, icon, name) in spaces()) list += "🗂️ Space: $icon $name" to { switchSpace(id) }
        return list
    }

    private fun quickCommands() {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Gloss.shape(this@MainActivity, Gloss.GLASS, 22)
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }
        val box = EditText(this).apply {
            hint = "⚡ Search tabs, bookmarks, history or commands"
            setSingleLine()
            textSize = 16f
            setTextColor(Gloss.INK)
            imeOptions = EditorInfo.IME_ACTION_GO
            background = Gloss.shape(this@MainActivity, intArrayOf(-1, -1, -1, -1), 999, strokeColor = look.orbs[2])
            setPadding(dp(16), dp(10), dp(16), dp(10))
        }
        card.addView(box, LinearLayout.LayoutParams(-1, -2))
        val results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        card.addView(ScrollView(this).apply { addView(results) }, LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = dp(8) })
        var first: (() -> Unit)? = null

        fun draw() {
            results.removeAllViews()
            val q = box.text.toString().trim()
            val found = mutableListOf<Pair<String, () -> Unit>>()
            val has = { text: String -> q.isEmpty() || text.contains(q, ignoreCase = true) }
            Calc.eval(q)?.let { v ->
                val shown = if (v == Math.floor(v) && Math.abs(v) < 1e15) v.toLong().toString() else "%.6g".format(v).trimEnd('0').trimEnd('.')
                found += "🧮 = $shown  (tap to copy)" to { copy(shown) }
            }
            for (t in tabs) if (has(t.title) || has(t.url)) found += "🗂 ${t.title}" to { showTab(t) }
            if (q.isNotEmpty()) {
                for ((url, title) in bookmarks()) if (has(title) || has(url)) found += "★ $title" to { go(url) }
                for ((url, title) in history) if (has(title) || has(url)) found += "🕘 ${title.ifEmpty { url }}" to { go(url) }
            }
            found += commands().filter { has(it.first) }
            if (q.isNotEmpty()) found += "🔍 Search the web for “$q”" to { go(q) }
            first = found.firstOrNull()?.second
            for ((label, action) in found.take(40)) {
                results.addView(TextView(this).apply {
                    text = label
                    textSize = 15f
                    maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                    setTextColor(Gloss.INK)
                    setPadding(dp(12), dp(10), dp(12), dp(10))
                    background = Gloss.shape(this@MainActivity, Gloss.GLASS, 12)
                    setOnClickListener { hideKeyboard(box); closeOverlay(); action() }
                }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(4) })
            }
        }
        box.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) = draw()
            override fun afterTextChanged(s: android.text.Editable?) {}
        })
        box.setOnEditorActionListener { _, _, _ -> val run = first; hideKeyboard(box); closeOverlay(); run?.invoke(); true }
        draw()
        openOverlay(card)
        box.requestFocus()
        handler.postDelayed({ (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(box, 0) }, 150)
    }

    private fun hideKeyboard(view: View) =
        (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(view.windowToken, 0)

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
}
