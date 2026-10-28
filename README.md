# Aero Browser

A glossy Frutiger Aero web browser that you own, so you can change anything about it.
It uses Chromium (the engine inside Chrome, Edge and Brave) to show websites. Everything around the page is ours: the tabs, toolbar, buttons, colours and the Aero New Tab.

## Install it

Run the newest **`dist\Aero-Browser-Setup-<version>.exe`**. It adds Aero Browser to the Start menu and the desktop like any other app.
Windows may show "Windows protected your PC" because the app isn't signed (signing costs money). Click **More info → Run anyway**.

While working on the code, you can also double-click **`Start Aero Browser.bat`** to run it without installing.

## Updates

From version 0.3.0, installed copies update themselves like Chrome. Every few hours they check this project's GitHub Releases, download new versions quietly, and install them the next time the browser closes. A green **Restart to update** button appears when an update is ready. After an update, the **What's new** page opens first.

### Releasing a new version

1. Change the code and bump `"version"` in `package.json`.
2. Add the new version at the top of `pages/whatsnew/changelog.js`.
3. Run `npm run build`.
4. Publish it (installed browsers pick it up automatically):

   ```bash
   gh release create v<version> dist/Aero-Browser-Setup-<version>.exe dist/Aero-Browser-Setup-<version>.exe.blockmap dist/latest.yml --title "Aero Browser <version>" --notes "What's new..."
   ```

## Custom themes

✨ Customize → **Custom themes** lists the themes in your themes folder (`%APPDATA%\Aero Browser\themes`). Each theme is a folder with a `theme.css` file, and optionally `newtab.css`, `websites.css` (every site) and `sites/<domain>.css` (one site, e.g. `sites/youtube.com.css`). The browser updates the moment you save. Bubble Pop and Luna XP are included as examples, and `THEME-GUIDE.md` in that folder explains everything you can change.

## What it has

- **Profiles & Google accounts**: click your profile picture to sign in to Google, add more accounts, or make extra profiles (like "School"). Each profile keeps its own logins
- 🔑 **Password manager**: offers to save passwords when you log in and fills them with one click. There's a Passwords panel with a generator and an optional PIN. Passwords are encrypted with your Windows account (safeStorage) in `%APPDATA%\Aero Browser\passwords`, one vault per profile, and never leave the computer
- ⚡ **Power**: live CPU/RAM graphs and per-tab usage. The RAM limiter puts unused background tabs to sleep, and the CPU limiter slows down busy background tabs (never the active tab or one playing sound)
- Tabs at the **top, bottom, left or right**
- Tabs with favicons and loading spinners, a glossy back/forward capsule, reload, home and an address bar that also searches
- A bookmarks bar: click ☆ in the address bar to add the current page, right-click a bookmark to remove it
- The Aero New Tab with all its widgets: music, weather, aquarium, timer, bubble wrap and more
- Aqua scrollbars and highlights on every website (you can turn this off)
- ✨ **Customize**: 8 themes, your own accent colour, shine level, tabs and toolbar at the top or bottom, tab shape, window button style, compact size, search engine and sounds

## Shortcuts

| Keys | Does |
| --- | --- |
| Ctrl+T / Ctrl+W | New tab / close tab |
| Ctrl+Tab | Next tab |
| Ctrl+L | Jump to the address bar |
| F5 | Reload |
| Alt+← / Alt+→ | Back / forward |
| Ctrl + / Ctrl − / Ctrl 0 | Zoom in / out / reset |
| F11 | Full screen |
| F12 | Developer tools |

## How it's built

- `main.js`: the engine room. It creates the window and the tabs, and handles navigation and shortcuts.
- `passwords.js`: the encrypted password vault. `power.js`: the CPU/RAM manager.
- `tab-preload.js`: a small helper inside every tab that spots login forms and fills them.
- `preload.js`: the safe "walkie-talkie" between the engine and the UI.
- `ui/`: the glossy controls (HTML, CSS and JS). Change these to change how the browser looks.
- `pages/newtab/`: the built-in Aero New Tab, opened at `aero://newtab/`.
- `pages/aero-sites.css`: the Aero touches added to every website.

Debug helpers: `AERO_USER_DATA=<folder>` uses a separate test data folder. Run with `AERO_SNAPSHOT=<folder>` and the browser saves `ui.png` and `tab.png` there, then closes.
