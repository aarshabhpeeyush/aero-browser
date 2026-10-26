# Making themes for Aero Browser

A theme is a folder in this **themes** folder. Each one can change how the browser looks, and the New Tab page too.

## Quick start

1. Copy the `bubble-pop` folder and rename the copy (for example `my-theme`).
2. Open `theme.json` and change the name, author and description.
3. In Aero Browser, open ✨ Customize → **Custom themes** and click your theme.
4. Edit `theme.css` and save. **The browser updates straight away**, so you can see each change as you make it.

## What goes in a theme folder

| File | What it does |
| --- | --- |
| `theme.json` | Name, author and description shown in Customize |
| `theme.css` | Restyles the browser: tabs, toolbar, buttons, panels |
| `newtab.css` | *(optional)* Restyles the New Tab page and its widgets |
| pictures and fonts | Use them from your CSS, e.g. `background: url(sky.png)` |

## Easiest changes: the colour variables

Put these in `theme.css` inside `:root { ... }`:

| Variable | Changes |
| --- | --- |
| `--frame-a`, `--frame-b` | Top and bottom colours of the tab bar |
| `--accent` | Buttons, highlights and the loading bar. Lighter and darker shades are made from it automatically |
| `--text` | Writing on the tab bar |
| `--text-shadow` | Shadow behind that writing |
| `--gloss` | How shiny the bars are, from `0` to `1` |
| `--tab-radius` | How round the tabs are, e.g. `16px` |
| `--bar-h`, `--tab-h` | Toolbar and tab heights |

## Parts of the browser you can style

| Selector | Part |
| --- | --- |
| `#titlebar` | The tab bar (also where you drag the window) |
| `.tab`, `.tab.active` | Tabs, and the one you're on |
| `#toolbar` | The bar with the back button and address bar |
| `.navpair`, `#back`, `#forward` | The back/forward capsule |
| `.orb`, `.orb.green` | Round glossy buttons |
| `#address`, `#url` | The address bar and the text inside it |
| `#bookmarks` | The bookmarks bar |
| `.winbtns button`, `.winbtns .close` | Minimise / maximise / close |
| `.avatar` | The profile picture button |
| `.panel` | The Customize and Profiles side panels |
| `#progress div` | The loading bar |

Your Customize choices add classes to `#app`, so a theme can react to them. For example, `.bars-bottom .tab { ... }` only applies when the tabs are at the bottom. The other classes are `.side`, `.bars-left`, `.bars-right`, `.shape-pill`, `.shape-square`, `.size-compact`, `.win-simple` and `.win-glossy`.

## New Tab page (`newtab.css`)

Useful selectors: `#scene` (the wallpaper), `.glass`, `.panel`, `.pill`, `.clock`, `.orb` and each widget by name: `.clock`, `.search`, `.dock`, `.tasks`, `.notes`, `.music`, `.weather`, `.aquarium`, `.calendar`, `.timer`, `.bubblewrap`.
**Tip:** open a New Tab and press **F12** to explore everything and try out changes live.

## Sharing your theme

Zip up your theme folder and send it to a friend. They unzip it, then in Customize click **Add a theme…** and choose its `theme.css`.
