// Customize panel: open Aquaris, or make a shortcut that starts Aeris straight into it.
$("#openAquaris").addEventListener("click", () => browser.runtime.sendMessage({ type: "open-aquaris" }));
$("#aquarisShortcut").addEventListener("click", async () => {
  try {
    await browser.aeris.makeAquarisShortcut();
    $("#aquarisNote").textContent = "✅ Done! Double-click \"Aquaris\" on your desktop to start Aeris as Aquaris, with its own sign-ins.";
  } catch (e) {
    $("#aquarisNote").textContent = e.message || String(e);
  }
});
