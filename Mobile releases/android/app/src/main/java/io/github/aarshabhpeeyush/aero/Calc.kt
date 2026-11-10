package io.github.aarshabhpeeyush.aero

import kotlin.math.pow

// Quick maths for Quick Commands, like "12*(3+4)" or "2^10" or "15% of 80". Returns null if it isn't maths.
object Calc {
    fun eval(text: String): Double? {
        val expr = text.lowercase().replace(" ", "").replace("×", "*").replace("÷", "/").replace("x", "*")
            .replace(Regex("([0-9.]+)%of"), "($1/100)*")
        if (!Regex("^[0-9.+\\-*/()^%]+$").matches(expr) || !Regex("[+\\-*/^%]").containsMatchIn(expr.drop(1))) return null
        return runCatching { Parser(expr).run { val v = sum(); if (pos != s.length) null else v } }.getOrNull()?.takeIf { it.isFinite() }
    }

    private class Parser(val s: String) {
        var pos = 0
        fun sum(): Double {
            var v = product()
            while (pos < s.length && s[pos] in "+-") v = if (s[pos++] == '+') v + product() else v - product()
            return v
        }
        fun product(): Double {
            var v = power()
            while (pos < s.length && s[pos] in "*/%") {
                val op = s[pos++]
                val r = power()
                v = when (op) { '*' -> v * r; '/' -> v / r; else -> v % r }
            }
            return v
        }
        fun power(): Double {
            val base = unary()
            return if (pos < s.length && s[pos] == '^') { pos++; base.pow(power()) } else base
        }
        fun unary(): Double = if (pos < s.length && s[pos] == '-') { pos++; -unary() } else atom()
        fun atom(): Double {
            if (s[pos] == '(') {
                pos++
                val v = sum()
                require(s[pos++] == ')')
                return v
            }
            val start = pos
            while (pos < s.length && (s[pos].isDigit() || s[pos] == '.')) pos++
            return s.substring(start, pos).toDouble()
        }
    }
}
