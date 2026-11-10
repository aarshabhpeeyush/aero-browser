package io.github.aarshabhpeeyush.aero

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.TextView

// The Frutiger Aero look: glossy gradients with a bright top half and a hard "shine" line in the middle.
object Gloss {
    val AQUA = intArrayOf(0xFFBDEFFF.toInt(), 0xFF63C8F5.toInt(), 0xFF2EA7EA.toInt(), 0xFF5CC8F7.toInt())
    val GREEN = intArrayOf(0xFFD8FFB0.toInt(), 0xFF7FDC4F.toInt(), 0xFF3CB52A.toInt(), 0xFF6FE04A.toInt())
    val GLASS = intArrayOf(0xFFFFFFFF.toInt(), 0xFFEAF8FF.toInt(), 0xFFD3F0FF.toInt(), 0xFFF0FBFF.toInt())
    val PRIVATE = intArrayOf(0xFFD9CCFF.toInt(), 0xFF8A74E0.toInt(), 0xFF5A43C0.toInt(), 0xFF7D6BE0.toInt())
    val GREY = intArrayOf(0xFFF4F7FA.toInt(), 0xFFC9D3DC.toInt(), 0xFFAAB6C2.toInt(), 0xFFC7D1DB.toInt())
    const val INK = 0xFF04345C.toInt()

    fun dp(ctx: Context, v: Int) = (v * ctx.resources.displayMetrics.density).toInt()

    fun shape(ctx: Context, colors: IntArray, radiusDp: Int, oval: Boolean = false, strokeColor: Int = 0xE6FFFFFF.toInt()) =
        GradientDrawable().apply {
            orientation = GradientDrawable.Orientation.TOP_BOTTOM
            setColors(colors, floatArrayOf(0f, 0.5f, 0.51f, 1f))
            if (oval) shape = GradientDrawable.OVAL else cornerRadius = dp(ctx, radiusDp).toFloat()
            setStroke(dp(ctx, 1), strokeColor)
        }

    // Round glossy button with a symbol or a few letters on it.
    fun orb(ctx: Context, text: String, colors: IntArray = AQUA, sizeDp: Int = 40) = TextView(ctx).apply {
        this.text = text
        gravity = Gravity.CENTER
        textSize = 16f
        setTextColor(Color.WHITE)
        typeface = Typeface.DEFAULT_BOLD
        setShadowLayer(3f, 0f, 1f, 0x99003C78.toInt())
        background = shape(ctx, colors, 0, oval = true)
        minimumWidth = dp(ctx, sizeDp)
        minimumHeight = dp(ctx, sizeDp)
        isClickable = true
        isFocusable = true
    }

    // Pill-shaped glossy button with a label, used in panels.
    fun pill(ctx: Context, text: String, colors: IntArray = GLASS) = TextView(ctx).apply {
        this.text = text
        gravity = Gravity.CENTER
        textSize = 15f
        setTextColor(if (colors === GLASS || colors === GREY) INK else Color.WHITE)
        background = shape(ctx, colors, 999)
        setPadding(dp(ctx, 16), dp(ctx, 10), dp(ctx, 16), dp(ctx, 10))
        isClickable = true
        isFocusable = true
    }
}
