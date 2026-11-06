
// ================= Aeris =================
// Aeris's defaults, added to the branding prefs at build time (see aeris/prepare.sh).
// You can still change any of these in Firefox settings or about:config.

// No Firefox welcome or "what's new" pages: Aeris shows its own What's New.
pref("browser.startup.homepage_override.mstone", "ignore");
pref("browser.aboutwelcome.enabled", false);
pref("startup.homepage_welcome_url", "");
pref("startup.homepage_override_url", "");
pref("browser.messaging-system.whatsNewPanel.enabled", false);

// Start where you left off, like Aero.
pref("browser.startup.page", 3);

// No ads, sponsored tiles or stories on Firefox's own New Tab (Aeris uses Aero's New Tab anyway).
pref("browser.newtabpage.activity-stream.showSponsored", false);
pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
pref("browser.urlbar.suggest.quicksuggest.sponsored", false);
pref("browser.urlbar.suggest.quicksuggest.nonsponsored", false);
pref("extensions.pocket.enabled", false);

// Aeris doesn't send usage data or run studies.
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("datareporting.healthreport.uploadEnabled", false);
pref("toolkit.telemetry.enabled", false);
pref("toolkit.telemetry.unified", false);
pref("toolkit.telemetry.archive.enabled", false);
pref("app.shield.optoutstudies.enabled", false);
pref("app.normandy.enabled", false);
pref("browser.discovery.enabled", false);

// Aero Originals are installed from inside Aeris, so they don't carry Mozilla's signature.
pref("xpinstall.signatures.required", false);

// Let people (and themes) restyle Aeris with userChrome.css, like Aero's custom themes.
pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);

// The welcome tour asks once whether Aeris should be your default browser; after that it never nags.
pref("browser.shell.checkDefaultBrowser", false);
