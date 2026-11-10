package io.github.aarshabhpeeyush.aero

import android.os.Bundle
import android.webkit.WebView
import androidx.webkit.ScriptHandler

const val NEW_TAB = "https://appassets.androidplatform.net/assets/index.html"

// One browser tab. A sleeping tab has no WebView: just its address and saved back/forward history.
class Tab(val incognito: Boolean, var url: String = NEW_TAB) {
    var webView: WebView? = null
    var title = "New Tab"
    var savedState: Bundle? = null
    var lastUsed = System.currentTimeMillis()
    var pageScript: ScriptHandler? = null // the theme script added to this tab's WebView
    var space = "home"     // Aeris spaces: which space (School, Games…) the tab belongs to
    var parent: Tab? = null // tab stacking: closing this tab goes back to the tab it was opened under
    val filters = mutableListOf<String>() // page filters on this tab (grayscale, sepia…)

    // Read from the web viewer's background thread by the ad blocker.
    @Volatile var pageHost: String? = null
    @Volatile var blocked = 0

    val asleep get() = webView == null
    val isNewTab get() = url.startsWith(NEW_TAB)
}
