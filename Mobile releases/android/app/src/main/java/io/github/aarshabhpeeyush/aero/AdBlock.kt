package io.github.aarshabhpeeyush.aero

// Built-in ad blocker: requests to these ad and tracker websites are stopped before they load.
// Subdomains count too, so "doubleclick.net" also blocks "ad.doubleclick.net".
object AdBlock {
    private val DOMAINS = setOf(
        // Google ads
        "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com",
        "pagead2.googlesyndication.com", "googletagservices.com", "google-analytics.com", "googletagmanager.com",
        "imasdk.googleapis.com",
        // Big ad networks and exchanges
        "amazon-adsystem.com", "adnxs.com", "adsrvr.org", "pubmatic.com", "rubiconproject.com", "openx.net",
        "criteo.com", "criteo.net", "casalemedia.com", "indexww.com", "smartadserver.com", "adform.net",
        "advertising.com", "yieldmo.com", "sharethrough.com", "triplelift.com", "3lift.com", "media.net",
        "bidswitch.net", "contextweb.com", "spotxchange.com", "spotx.tv", "teads.tv", "33across.com",
        "sovrn.com", "lijit.com", "gumgum.com", "undertone.com", "districtm.io", "adcolony.com",
        "applovin.com", "unityads.unity3d.com", "inmobi.com", "mopub.com", "vungle.com", "chartboost.com",
        "adtechus.com", "zedo.com", "revcontent.com", "mgid.com", "propellerads.com", "popads.net",
        "popcash.net", "adsterra.com", "exoclick.com", "juicyads.com", "trafficjunky.net", "hilltopads.net",
        "admixer.net", "adroll.com", "smaato.net", "rlcdn.com", "emxdgt.com", "onetag-sys.com",
        // "Recommended for you" link farms
        "taboola.com", "outbrain.com", "zergnet.com", "content.ad", "nativo.com",
        // Trackers and analytics
        "scorecardresearch.com", "quantserve.com", "quantcount.com", "moatads.com", "moatpixel.com",
        "doubleverify.com", "adsafeprotected.com", "chartbeat.com", "chartbeat.net", "hotjar.com",
        "mouseflow.com", "crazyegg.com", "fullstory.com", "mixpanel.com", "segment.io", "amplitude.com",
        "branch.io", "app-measurement.com", "bluekai.com", "demdex.net", "everesttech.net", "krxd.net",
        "exelator.com", "agkn.com", "tapad.com", "mathtag.com", "turn.com", "eyeota.net", "omtrdc.net",
        "2o7.net", "newrelic.com", "nr-data.net", "clarity.ms", "bat.bing.com", "ads.linkedin.com",
        "analytics.tiktok.com", "ads.tiktok.com", "ads-api.tiktok.com", "connect.facebook.net",
        "an.facebook.com", "ads.twitter.com", "static.ads-twitter.com", "ads.pinterest.com",
        "ct.pinterest.com", "sc-static.net", "tr.snapchat.com", "ads.yahoo.com", "analytics.yahoo.com",
        "adtech.de", "ads.reddit.com", "events.redditmedia.com", "pixel.wp.com", "stats.wp.com"
    )

    fun blocks(host: String?): Boolean {
        var h = host?.lowercase() ?: return false
        while (true) {
            if (h in DOMAINS) return true
            val dot = h.indexOf('.')
            if (dot < 0) return false
            h = h.substring(dot + 1)
        }
    }
}
