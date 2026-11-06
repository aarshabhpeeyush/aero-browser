// Gives Aeris's own pages (New Tab, What's New, Settings) the active theme's newtab.css, like Aero did,
// and swaps it straight away when you pick another theme.
(() => {
  const link = document.getElementById("aeroTheme");
  if (!link) return;
  let themes = null;
  async function apply() {
    themes ??= await (await fetch("/themes/index.json")).json();
    const { theme } = await browser.storage.local.get({ theme: "aqua-glass" });
    const t = themes.find(x => x.id === theme);
    if (t?.newtabCss) link.href = `/themes/${t.id}/newtab.css`;
    else link.removeAttribute("href");
  }
  apply();
  browser.storage.onChanged.addListener(c => c.theme && apply());
})();
