# Aquaris design notes

Research on how today's operating systems look and feel (November 2026), and what Aquaris takes
from each. Aquaris is its own app: a desktop OS that runs on Aeris's engine. Aeris opens inside it.

## What the big systems are doing

**macOS 27 "Golden Gate" (WWDC 2026).** Apple kept Liquid Glass but toned it down after a year of
complaints about hard-to-read text. Glass now blurs busy content more, there is a slider in
Settings from "clear" to "tinted", every window uses one fixed corner radius, toolbars look
uniform again, and app icons are layered squircles with light, dark, clear and tinted versions.
Lesson: glass looks great on small floating controls, but text on glass must stay readable, and
people want a "less glass" option.

**Windows 11 (26H2 update, autumn 2026).** Not a full redesign, but Start, the taskbar and Search
are being rebuilt: movable/resizable taskbar, Start menu in preset sizes with sections you can turn
on and off (Pinned, Recent, All), and a Run box built like a command palette. Fluent's rules: app
windows and flyouts have 8px corners, buttons 4px, snapped/maximised windows are square. Mica (a
calm, tinted material) for long-lived surfaces like windows, Acrylic (strong blur) only for
short-lived ones like menus.

**Linux: GNOME 49 and KDE Plasma 6.x.** GNOME is minimal and opinionated: top bar with the clock in
the middle, a search-first overview, quick-settings toggles, Adwaita's calm flat style. Plasma is
the "customise everything" one: flexible window tiling, KRunner (type anything, get results),
pinned clipboard. Lesson: search-first launching and good tiling are now expected.

**Android 16 / Material 3 Expressive, and Google's "Aluminium" desktop (Android on PCs, 2026).**
Bolder colour, playful shapes, and springy motion (bouncy for movement, smooth for fades). The
leaked Android desktop has a ChromeOS-like taskbar with the launcher near the centre, a PC-style
status bar, real windows with minimise/maximise/resize, and split-screen.

**Web desktops (BrowOS, daedalOS, Puter, ProzillaOS).** BrowOS: dark, calm, one compact floating
dock holding the launcher, open apps and clock, thin borders, small crisp type, few colours.
daedalOS: a faithful, fast desktop in the browser. Common problem: they're "pretend" desktops in a
tab. Aquaris's advantage is that it runs on a real engine and can manage real browser windows.

**Design trend pieces for 2026** agree: restrained glass (depth with a purpose, not blur
everywhere), motion that explains what happened, spatial layering, and accessibility switches
(reduce motion, reduce transparency, more contrast) built in, not bolted on.

## Aquaris's design rules

1. **Content first.** The system steps back. Windows use a calm, mostly solid material (like Mica);
   strong glass is only for floating things: top bar, dock, launcher, menus.
2. **Always readable.** Text never sits on raw see-through glass. Menus are frosted enough to read
   even when blur isn't available. A Glass slider (Clear ↔ Frosted) and a Reduce motion switch.
3. **One geometry.** Windows 12px corners, buttons and fields 8px, small controls round. Maximised
   and snapped windows are square. One spacing scale (4px steps).
4. **Familiar layout.**
   - Top bar (macOS, GNOME, Android desktop): launcher and the active app's name on the left,
     date and time in the middle, memory and quick settings on the right.
   - Centred floating dock (Windows 11, Android desktop, BrowOS): pinned apps, open apps with a
     dot, Aeris windows, the launcher button at its start.
5. **Search first.** The launcher opens with the cursor in a search box (Spotlight, KRunner,
   Windows Run): type an app, a website or a question. Below it, pinned apps and all apps.
6. **Quick settings** (Android, GNOME, Windows): light/dark, glass level, wallpaper, full screen,
   "nap hidden apps".
7. **Windows that behave.** Snap to halves and quarters by dragging to edges and corners, double-
   click the title to maximise, keyboard shortcuts, open/minimise animations that come from and go
   to the dock.
8. **One icon set.** Squircle icons on one grid with the same soft depth, a white glyph, light and
   dark variants. No emoji anywhere in the system's interface.
9. **Motion with meaning.** Short (150–250 ms), springy for movement, smooth for fades, and all of
   it switched off by Reduce motion.
10. **Light and dark** follow the computer's setting (or are picked), with an accent colour.
11. **Our own flair: water.** The drop is the launcher. Glass rims catch a soft cyan light, the
    default wallpaper is calm water and light, and the optional **Frutiger Aqua** skin turns the
    same layout into a glossy, candy-gel Mac OS X style desktop.

## Aquaris as its own app

- Its own program, profile, window icon and taskbar button (Aeris's engine features for "web app"
  windows: `WindowsUIUtils.setWindowIcon`, `WinTaskbar.setGroupIdForWindow`).
- Aeris's bars never show in the Aquaris window; when it isn't full screen it gets a normal title bar.
- "Open Aquaris" in Aeris starts Aquaris as a separate app, and Aeris opens inside Aquaris.

## Sources

- macOS 27: https://www.macrumors.com/roundup/macos-27/ ,
  https://www.cultofmac.com/news/liquid-glass-changes-ios-27-macos-27 ,
  https://wccftech.com/macos-27-golden-gate-preview-announced-at-wwdc-2026/amp/
- Liquid Glass legibility: https://infinum.com/blog/apples-ios-26-liquid-glass-sleek-shiny-and-questionably-accessible/ ,
  https://webdesignerdepot.com/how-liquid-design-broke-the-iphone-and-forced-apples-great-reset/
- App icons: https://mjtsai.com/blog/2025/06/19/macos-tahoes-new-theming-system/
- Windows 11: https://www.ghacks.net/2026/07/27/windows-11-version-26h2-restores-movable-taskbar-and-adds-start-menu-section-toggles-and-search-controls/ ,
  https://www.pcworld.com/article/3183164/windows-11-start-menu-redesign-is-getting-a-redesign.html ,
  https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/geometry ,
  https://learn.microsoft.com/windows/apps/get-started/make-apps-great-for-windows
- Linux: https://linuxiac.com/kali-linux-2025-4-released-with-gnome-49-kde-plasma-6-5/ ,
  https://en.wikipedia.org/wiki/KDE_Plasma_6 ,
  https://www.howtogeek.com/gnome-or-kde-plasma-choosing-the-wrong-one-can-ruin-your-linux-experience/
- Android / Material 3 Expressive: https://9to5google.com/2025/05/13/android-16-material-3-expressive-redesign/ ,
  https://www.androidcentral.com/chromebooks-laptops/googles-aluminium-os-could-be-androids-big-desktop-breakout
- Web desktops: https://browos.site/ , https://linuxlinks.com/daedalos-desktop-environment-web-browser
- Trends: https://www.pixelmatters.com/insights/7-UI-design-trends-to-watch-in-2026 ,
  https://www.wearetenet.com/blog/ui-ux-design-trends
