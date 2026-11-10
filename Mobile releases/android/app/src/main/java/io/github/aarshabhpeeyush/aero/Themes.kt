package io.github.aarshabhpeeyush.aero

import android.content.Context
import android.graphics.Color
import org.json.JSONObject

// Aeris's look, the same layering as on the computer: a colour theme (8 colours, Minimal, or your own
// from Theme Studio) underneath, and optionally a custom theme (one of Aero's theme folders in
// assets/themes, like Woodland Hut) on top, which also restyles the New Tab and websites.

class ColorTheme(val id: String, val name: String, val a: Int, val b: Int, val accent: Int, val gloss: Float = 0.9f)

// A custom theme folder: theme.json, theme.css (its colours), and optionally newtab.css,
// websites.css (every site) and sites/<domain>.css (one site).
class Theme(
    val id: String,
    val name: String,
    val description: String,
    val frameA: Int,
    val frameB: Int,
    val accent: Int,
    val gloss: Float,
)

// What the bar and its round buttons look like.
class Look(val bar: IntArray, val orbs: IntArray)

object Themes {
    private fun c(hex: String) = Color.parseColor(hex)

    // The same as app/aeris-colors.js and the computer's Aeris (aeris/addon/background.js).
    val COLORS = listOf(
        ColorTheme("frost", "Frost", c("#c3d8ea"), c("#e2eef8"), c("#3d8bd4")),
        ColorTheme("aqua", "Aqua Sky", c("#1f7fd6"), c("#7fd0ff"), c("#1e9be8")),
        ColorTheme("meadow", "Meadow", c("#2f8f3f"), c("#a8e66b"), c("#3cb83c")),
        ColorTheme("ocean", "Deep Ocean", c("#031f45"), c("#0b6fb5"), c("#22b8e0")),
        ColorTheme("bubblegum", "Bubblegum", c("#d0287f"), c("#ffb3e0"), c("#ff5fb0")),
        ColorTheme("sunset", "Sunset", c("#e8601a"), c("#ffd27a"), c("#ff8c1a")),
        ColorTheme("silver", "Silver", c("#7a8b9a"), c("#e6eef4"), c("#4c7fb0")),
        ColorTheme("midnight", "Midnight", c("#0b0f1e"), c("#26324f"), c("#5a7dff")),
        ColorTheme("minimal", "Minimal", c("#fafafa"), c("#e9e9ed"), c("#0061e0"), gloss = 0f),
    )

    private var cache: List<Theme>? = null

    private fun read(ctx: Context, path: String) =
        runCatching { ctx.assets.open(path).bufferedReader().use { it.readText() } }.getOrDefault("")

    fun list(ctx: Context): List<Theme> = cache ?: buildList {
        for (id in ctx.assets.list("themes").orEmpty().sorted()) {
            val info = runCatching { JSONObject(read(ctx, "themes/$id/theme.json")) }.getOrNull() ?: continue
            val css = read(ctx, "themes/$id/theme.css")
            fun color(name: String, fallback: Int) = Regex("--$name:\\s*(#[0-9a-fA-F]{3,6})\\b").find(css)?.groupValues?.get(1)
                ?.let { hex -> if (hex.length == 4) "#" + hex.drop(1).map { "$it$it" }.joinToString("") else hex }
                ?.let { runCatching { Color.parseColor(it) }.getOrNull() } ?: fallback
            val gloss = Regex("--gloss:\\s*([0-9.]+)").find(css)?.groupValues?.get(1)?.toFloatOrNull() ?: 0.6f
            add(Theme(id, info.optString("name", id), info.optString("description"),
                color("frame-a", 0xFF2EA7EA.toInt()), color("frame-b", 0xFF5CC8F7.toInt()), color("accent", 0xFF2EA7EA.toInt()), gloss))
        }
    }.also { cache = it }

    fun get(ctx: Context, id: String?) = list(ctx).find { it.id == id }

    fun mix(a: Int, b: Int, t: Float) = Color.rgb(
        (Color.red(a) + (Color.red(b) - Color.red(a)) * t).toInt(),
        (Color.green(a) + (Color.green(b) - Color.green(a)) * t).toInt(),
        (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t).toInt(),
    )

    // Glossy colours: a bright top half, a hard shine line, then the two frame colours. No gloss = flat.
    private fun gloss(a: Int, b: Int, g: Float) = intArrayOf(mix(a, Color.WHITE, 0.45f * g), mix(a, Color.WHITE, 0.15f * g), a, b)
    private fun orb(accent: Int, g: Float) = intArrayOf(
        mix(accent, Color.WHITE, 0.15f + 0.45f * g), mix(accent, Color.WHITE, 0.25f * g), accent, mix(accent, Color.WHITE, 0.2f * g))

    // studio = your own look from Theme Studio (used when the colour theme is "studio")
    fun look(ctx: Context, colorId: String?, customId: String?, studio: ColorTheme?): Look {
        get(ctx, customId)?.let { t -> return Look(gloss(t.frameA, t.frameB, t.gloss), orb(t.accent, 0.8f)) }
        val ct = if (colorId == "studio" && studio != null) studio else COLORS.find { it.id == colorId } ?: COLORS[0]
        return Look(gloss(ct.a, ct.b, ct.gloss), orb(ct.accent, maxOf(ct.gloss, 0.3f)))
    }

    // The script every page runs at its start: the custom theme's CSS for websites, its New Tab look,
    // paper colours, Aero style, things you hid on websites, and saving files that pages make themselves.
    fun pageScript(ctx: Context, customId: String?, aeroStyle: Boolean, zaps: JSONObject): String {
        val t = get(ctx, customId)
        val sites = JSONObject()
        var paper = JSONObject()
        var websites = ""
        var newtab = ""
        if (t != null) {
            val folder = "themes/${t.id}"
            websites = read(ctx, "$folder/websites.css")
            for (file in ctx.assets.list("$folder/sites").orEmpty()) {
                if (file.endsWith(".css")) sites.put(file.removeSuffix(".css").lowercase(), read(ctx, "$folder/sites/$file"))
            }
            paper = runCatching { JSONObject(read(ctx, "$folder/theme.json")).optJSONObject("paper") }.getOrNull() ?: JSONObject()
            if ("newtab.css" in ctx.assets.list(folder).orEmpty()) newtab = "/assets/$folder/newtab.css"
        }
        val config = JSONObject()
            .put("css", JSONObject()
                .put("base", if (aeroStyle) read(ctx, "site/aero-sites.css") else "")
                .put("websites", websites)
                .put("fixes", read(ctx, "site/site-fixes.css"))
                .put("sites", sites))
            .put("paper", paper)
            .put("newtabCss", newtab)
            .put("zaps", zaps)
        return "(function (AERO) {\n" + read(ctx, "site/aero-page.js") + "\n})(" + config + ");"
    }
}
