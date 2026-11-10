package io.github.aarshabhpeeyush.aero

import android.text.Html

// The bookmarks file every browser can import and export (Chrome, Edge, Firefox, Opera GX, the desktop Aero).
object BookmarkFile {
    private fun escape(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

    fun write(list: List<Pair<String, String>>): String = buildString {
        append("<!DOCTYPE NETSCAPE-Bookmark-file-1>\n")
        append("<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">\n")
        append("<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n")
        append("    <DT><H3>Aero for Android</H3>\n    <DL><p>\n")
        for ((url, title) in list) append("        <DT><A HREF=\"${escape(url)}\">${escape(title)}</A>\n")
        append("    </DL><p>\n</DL><p>\n")
    }

    // Every link in the file, folders flattened. Only web addresses are kept.
    fun read(html: String): List<Pair<String, String>> =
        Regex("<A\\s[^>]*HREF=\"([^\"]+)\"[^>]*>(.*?)</A>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
            .findAll(html)
            .map { m ->
                val url = Html.fromHtml(m.groupValues[1], Html.FROM_HTML_MODE_LEGACY).toString()
                val title = Html.fromHtml(m.groupValues[2], Html.FROM_HTML_MODE_LEGACY).toString().trim()
                url to title.ifEmpty { url }
            }
            .filter { it.first.startsWith("http://") || it.first.startsWith("https://") }
            .toList()
}
