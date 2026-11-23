// Gives Aeris's own pages (New Tab, What's New, the Aeris Store) the active theme's newtab.css, like Aero did,
// and swaps it straight away when you pick another theme. Your own themes aren't inside Aeris, so their
// newtab.css comes from Aeris Core as text.
(() => {
  const link = document.getElementById("aeroTheme");
  if (!link) return;
  let blobUrl = null;
  async function apply() {
    const [{ custom }, { theme }] = await Promise.all([
      browser.runtime.sendMessage({ type: "themes" }),
      browser.storage.local.get({ theme: null })
    ]);
    const t = custom.find(x => x.id === theme);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = null;
    if (!t?.newtabCss) return link.removeAttribute("href");
    if (!t.personal) return (link.href = `/themes/${t.id}/newtab.css`);
    const css = await browser.runtime.sendMessage({ type: "theme-file", id: t.id, file: "newtab.css" });
    blobUrl = URL.createObjectURL(new Blob([css], { type: "text/css" }));
    link.href = blobUrl;
  }
  apply();
  browser.storage.onChanged.addListener(c => c.theme && apply());
})();
