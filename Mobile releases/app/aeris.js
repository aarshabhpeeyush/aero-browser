// Aeris on the home-screen web app (iPhone, iPad and Android): the welcome tour on the first visit,
// and a Look section in Settings for the colour theme and a custom theme for this page.
// Inside the Aeris Android app this does nothing, because the app sets the look itself.

(() => {
  if (window.AeroNative) return;
  if (!localStorage.getItem("aeris-welcomed")) {
    location.replace("welcome/");
    return;
  }

  let themes = [];
  const link = document.createElement("link");
  link.id = "aeroTheme";
  link.rel = "stylesheet";
  document.head.append(link);

  function apply() {
    const look = aerisLook();
    const color = AERIS_COLORS[look.colorTheme] || AERIS_COLORS.frost;
    document.querySelector('meta[name="theme-color"]').content = color.a;
    const t = themes.find(x => x.id === look.theme);
    if (t?.newtabCss) link.href = `themes/${t.id}/newtab.css`;
    else link.removeAttribute("href");
  }

  function settingsSection() {
    const look = aerisLook();
    const section = document.createElement("section");
    section.innerHTML = `
      <h3>Look</h3>
      <label class="field">Colour <select id="setColour"></select></label>
      <label class="field">Theme <select id="setTheme"><option value="">No custom theme</option></select></label>
      <p class="hint">The colour tints the bar at the top of your screen. Themes restyle this page.</p>
      <button class="gel" id="replayTour">Show the welcome tour again</button>`;
    const colour = section.querySelector("#setColour");
    for (const [id, c] of Object.entries(AERIS_COLORS)) colour.add(new Option(c.name, id, false, id === look.colorTheme));
    const theme = section.querySelector("#setTheme");
    for (const t of themes.filter(t => t.newtabCss)) theme.add(new Option(t.name, t.id, false, t.id === look.theme));
    colour.addEventListener("change", () => { saveAerisLook({ colorTheme: colour.value }); apply(); });
    theme.addEventListener("change", () => { saveAerisLook({ theme: theme.value || null }); apply(); });
    section.querySelector("#replayTour").addEventListener("click", () => {
      localStorage.removeItem("aeris-welcomed");
      location.href = "welcome/";
    });
    // Goes first, above the battery saver and widgets
    document.querySelector("#settings header").after(section);
  }

  fetch("themes/index.json").then(r => r.json()).catch(() => []).then(list => {
    themes = list;
    apply();
    if (document.readyState === "loading") addEventListener("DOMContentLoaded", settingsSection);
    else settingsSection();
  });
  apply();
})();
