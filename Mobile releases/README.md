# Aeris for phones and tablets

Aeris (the Firefox-based Aero) on Android, iPhone and iPad. There are two parts:

- **`Aeris-1.1.0.apk`**: the **Aeris app for Android**. It's a real browser with tabs, themes on websites,
  an ad blocker and the rest. Install it from the file; no Play Store needed.
- **`app/`**: the **Aeris web app** for **iPhone, iPad** and Android. It's Aeris's start page (bubbles,
  widgets, wallpapers, themes) that you add to your home screen.

Source code: `android/` (the app) and `app/` (the web app, which the Android app also uses as its New Tab).

## The Android app: what it has

| | |
|---|---|
| 🎨 **Looks** | Aeris's 8 colour themes plus Minimal, the 9 custom themes (Aqua Glass, DORFic, Woodland Hut…) that also restyle Google, YouTube and Wikipedia, 🖌️ Theme Studio for your own look, and day/night themes that switch on their own |
| ⚡ **Quick Commands** | One box for your tabs, bookmarks, history, quick maths and commands like "Theme: Sunset" (⋮ menu, or F2 with a keyboard) |
| 📝 **Notes** | Write notes and clip pages or links (press and hold a link → Clip to Aeris Notes) |
| 🗂️ **Spaces & tabs** | School, Games and Music spaces, tab stacking (+ opens a tab under another), sleeping tabs, reopen closed tabs |
| ◫ **Split screen** | Two pages at once, with a middle bar you can drag |
| 🛡️ **Ad blocker** | Built in, with a shield that counts what it blocked |
| ⛶ **Focus mode** | Hides the bar; tap ⛶ to bring it back |
| 🙈 **Hide this** | ⋮ → More → Hide something on this page, then tap it. Aeris remembers it for that site |
| 🌗 **Page filters** | Grayscale, dark, sepia, high contrast, no images, readable font |
| 🕶 **Private tabs** | Their own cookies, wiped when closed |
| 🤖 **No AI Overviews** | Google searches show plain results |
| 🖼️ **Save image** | Press and hold a picture. Downloads, bookmark import/export, full-screen video |
| 🎧 **Beat Lab** | The Aero Original music studio (⋮ → More → Aero Originals) |
| 🔋 **Battery & breaks** | Battery saver, break reminders, ⚡ Power |

Not possible on Android: Firefox add-ons, School Assist and Desktop GIFs (they need browser extensions),
PDFs inside Aeris (they download instead) and separate profiles. Your phone's password manager still fills passwords.

### Install it on Android
1. Download **`Aeris-1.1.0.apk`** onto the phone.
2. Tap it. If Android asks, tap **Settings** → turn on **Allow from this source** → go back.
3. Tap **Install**. If Play Protect warns about an "unknown app", tap **More details** → **Install anyway**.
   It warns because Aeris isn't from the Play Store.
4. Open **Aeris**. A welcome tour helps you pick your colours and settings.

Updates install over the old version, and your tabs and settings stay.

## The web app (iPhone, iPad and Android)

It's Aeris's start page, so websites you open still use Safari or Chrome. It has the welcome tour,
the colour themes and custom themes, widgets, quick app shortcuts and a battery saver, and it works offline.

**Link: https://aarshabhpeeyush.github.io/aero-browser/aeris/** (it updates by itself when `app/` changes here). Open it, then:
- **iPhone / iPad (Safari):** open the link → **Share** → **Add to Home Screen** → **Add**.
- **Android (Chrome):** open the link → **⋮** → **Install app**.

## Building (for developers)

- Android: in `android/`, run `./gradlew assembleDebug` with Android Studio's Java
  (`JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`). The app is native Kotlin with Android's WebView.
- Themes and site styles are copies of `themes-builtin` and `pages/*.css`. Copy them again into
  `app/themes` and `android/app/src/main/assets/` when the computer version changes them.
- When `app/` changes, bump `VERSION` in `app/sw.js` so phones fetch the new files.
