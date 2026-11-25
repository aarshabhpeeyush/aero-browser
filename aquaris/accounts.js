// Aquaris accounts: a desktop for each person, signed in with their Google account (or just a name).
// Each account has its own settings and its own website sign-ins, so signing in with Google here
// also signs that person into Gmail, YouTube and Docs in their own account only. Passwords are only
// ever typed into Google's own page. The lock screen picks the account (with an optional PIN).

// ----- Who signed in to Google -----
// Once you've signed in, Google lands on your Google Account page; Aeris (on a computer) or the
// iPad app reads your name, email and photo there and tells Aquaris (googleSignedIn below).
let pendingGoogle = null;   // { acc, win, done(who) }
const canUseGoogle = inChrome || inShell;

// ----- Making and removing accounts -----
// Firefox's containers (where it lives moved between versions)
function containerService() {
  for (const url of ["moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs", "resource://gre/modules/ContextualIdentityService.sys.mjs"]) {
    try { return ChromeUtils.importESModule(url); } catch {}
  }
  throw new Error("Containers aren't available");
}
async function newSpace() {
  if (inChrome) {
    const { ContextualIdentityService } = containerService();
    const id = ContextualIdentityService.create("Aquaris account", "fingerprint", "turquoise");
    return { ctx: id.userContextId, store: "" };
  }
  return { ctx: 0, store: inShell ? crypto.randomUUID() : "" };
}
async function removeAccount(acc) {
  accounts.list = accounts.list.filter(a => a.id !== acc.id);
  await accounts.save();
  if (inChrome) {
    try {
      // Its website sign-ins (the first account's live in Aquaris's main space)
      Services.clearData.deleteDataFromOriginAttributesPattern({ userContextId: acc.ctx || 0 });
      if (acc.ctx) {
        const { ContextualIdentityService } = containerService();
        ContextualIdentityService.remove(acc.ctx);
      }
      await IOUtils.remove(PathUtils.join(PathUtils.profileDir, acc.id === "main" ? "aquaris.json" : `aquaris-${acc.id}.json`), { ignoreAbsent: true });
    } catch (e) { console.error("Aquaris account:", e); }
  } else {
    if (inShell) shell.postMessage(acc.store ? { cmd: "removeStore", store: acc.store } : { cmd: "clearDefaultStore" });
    if (inShell) shell.postMessage({ cmd: "save", key: accounts.key(acc.id), data: "{}" });
    try { localStorage.removeItem(accounts.key(acc.id)); } catch {}
  }
}
// Delete an account. The one you're using is deleted after switching to another account.
async function deleteAccount(acc, page) {
  if (accounts.list.length < 2) return alertIn(page, "Aquaris needs at least one account, so the last one can't be deleted.");
  if (acc.pin) {
    const pin = await askText(page, `${accName(acc)}'s PIN, to delete the account`, "");
    if (pin == null) return false;
    if ((await pinHash(pin, acc.salt)) !== acc.pin) { alertIn(page, "That PIN isn't right."); return false; }
  }
  if (!(await askYes(page, `Delete ${accName(acc)}'s account? Its desktop, apps, settings and website sign-ins on this device are deleted. This can't be undone.`))) return false;
  if (acc.id !== accounts.current) { await removeAccount(acc); return true; }
  accounts.pendingDelete = acc.id;
  await switchAccount(accounts.list.find(a => a.id !== acc.id).id);
  return true;
}
async function switchAccount(id) {
  if (id === accounts.current) return;
  accounts.current = id;
  await accounts.save();
  saveLayout?.();
  await new Promise(r => setTimeout(r, 500));   // let the last settings save
  if (inShell) shell.postMessage({ cmd: "reset" });
  location.reload();
}

// ----- Sign in with Google -----
// Opens Google's sign-in page in the account's own space. Once you're signed in there, Aquaris reads
// your name, email and photo, and that account's Gmail, YouTube and Docs are signed in too.
async function googleSignIn(acc, { fresh = false } = {}) {
  const space = { ctx: acc.ctx || 0, store: acc.store || "" };
  const app = { id: "signin-" + acc.id, name: "Sign in with Google", url: "https://accounts.google.com/ServiceLogin?continue=" + encodeURIComponent("https://myaccount.google.com/"), color: "#4285f4", ui: "globe", space, size: [520, 680] };
  const win = openApp(app);
  pendingGoogle = {
    acc, win,
    async done(who) {
      pendingGoogle = null;
      Object.assign(acc, { name: acc.name && acc.name !== "New account" ? acc.name : who.name, email: who.email, photo: who.photo });
      if (!accounts.list.includes(acc)) accounts.list.push(acc);
      await accounts.save();
      if (wins.includes(win)) closeWin(win);
      notify({ app: "settings", title: "Signed in with Google", body: `${who.name} (${who.email}) has an Aquaris account now.`, from: "accounts" });
      drawAccountsAgain();
      if (acc.id !== accounts.current && await askYes($("#desktop"), `Switch to ${who.name}'s desktop now?`)) switchAccount(acc.id);
    }
  };
  // Closed before signing in: a new account that never signed in is taken away again
  const watch = setInterval(async () => {
    if (pendingGoogle?.win !== win) return clearInterval(watch);
    if (!wins.includes(win)) {
      clearInterval(watch);
      pendingGoogle = null;
      if (fresh && !acc.email) await removeAccount(acc);
      drawAccountsAgain();
    }
  }, 1500);
}
// Aeris or the iPad app tells us who signed in
function googleSignedIn(who) {
  if (!pendingGoogle || !who?.email || !/^[^\s@]+@[^\s@]+$/.test(who.email)) return;
  pendingGoogle.done({ name: who.name || who.email.split("@")[0], email: who.email, photo: /^https:\/\//.test(who.photo || "") ? who.photo : "" });
}
// Pages that list accounts (Settings) redraw when an account changes
let accountRedraws = new Set();
const drawAccountsAgain = () => accountRedraws.forEach(f => f());

// ----- PINs (kept as a salted hash, never the PIN itself) -----
async function pinHash(pin, salt) {
  const data = new TextEncoder().encode(salt + ":" + pin);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function setPin(acc, pin) {
  if (!pin) { acc.pin = ""; acc.salt = ""; }
  else { acc.salt = crypto.randomUUID(); acc.pin = await pinHash(pin, acc.salt); }
  await accounts.save();
}

// ----- Pictures of people -----
function avatar(acc, size = 40) {
  const a = html("span", "avatar");
  a.style.setProperty("--s", size + "px");
  if (acc.photo) {
    const img = html("img");
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.src = acc.photo;
    img.addEventListener("error", () => { img.remove(); a.textContent = initials(acc); });
    a.append(img);
  } else a.textContent = initials(acc);
  return a;
}
const initials = acc => (acc.name || acc.email || "You").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
const accName = acc => acc.name || (acc.id === "main" ? "You" : "Account");

// ----- The lock screen: pick an account, type its PIN -----
function accountLock({ pick = false } = {}) {
  const l = $("#lock");
  setHTML(l, `<div class="lock-time"></div><div class="lock-date"></div><div class="lock-people"></div><form class="lock-pin" hidden><input type="password" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="PIN"><button class="btn primary">Unlock</button><p class="lock-wrong" hidden>That PIN isn't right.</p></form><p class="lock-hint"></p>`);
  const draw = () => {
    const now = new Date();
    l.querySelector(".lock-time").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    l.querySelector(".lock-date").textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  };
  draw();
  const timer = setInterval(draw, 5000);
  const people = l.querySelector(".lock-people"), form = l.querySelector(".lock-pin"), input = form.querySelector("input");
  let chosen = accounts.me();
  const several = accounts.list.length > 1;
  const finish = () => { l.hidden = true; clearInterval(timer); removeEventListener("keydown", anyKey, true); };
  const go = acc => (acc.id === accounts.current ? finish() : switchAccount(acc.id));
  const choose = acc => {
    chosen = acc;
    people.querySelectorAll(".lock-person").forEach(b => b.classList.toggle("on", b.dataset.id === acc.id));
    if (acc.pin) { form.hidden = false; input.value = ""; form.querySelector(".lock-wrong").hidden = true; setTimeout(() => input.focus(), 30); }
    else { form.hidden = true; go(acc); }
  };
  for (const acc of accounts.list) {
    const b = html("button", "lock-person" + (acc.id === chosen.id ? " on" : ""));
    b.dataset.id = acc.id;
    b.append(avatar(acc, several ? 64 : 88), html("b", "", accName(acc)), html("small", "", acc.email || ""));
    b.addEventListener("click", e => { e.stopPropagation(); choose(acc); });
    people.append(b);
  }
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if ((await pinHash(input.value, chosen.salt)) === chosen.pin) go(chosen);
    else { form.querySelector(".lock-wrong").hidden = false; input.select(); }
  });
  l.querySelector(".lock-hint").textContent = several ? "Pick your account" : chosen.pin ? "Type your PIN to unlock" : "Click or press any key to unlock";
  // One account without a PIN: any click or key unlocks, like before
  const anyKey = e => { if (!several && !chosen.pin && !e.target.closest?.(".lock-pin")) finish(); };
  if (!several && chosen.pin) { form.hidden = false; setTimeout(() => input.focus(), 100); }
  l.onclick = e => { if (!several && !chosen.pin && !e.target.closest(".lock-pin")) finish(); };
  setTimeout(() => addEventListener("keydown", anyKey, true), 300);
  l.hidden = false;
  if (pick && several) l.querySelector(".lock-hint").textContent = "Pick an account";
}

// ----- Settings → Accounts -----
function accountsSettingsSection() {
  return `<section class="acc-sec"><h3>Accounts</h3>
    <p class="hint">Each account is its own desktop with its own apps, look and website sign-ins. Sign in with Google to bring your name and photo, and to be signed in to Gmail, YouTube and Docs in your account.</p>
    <div class="acc-list"></div>
    <div class="row"><button class="btn primary" data-a="add-google"${canUseGoogle ? "" : " hidden"}>Add account with Google</button><button class="btn" data-a="add-name">Add account without Google</button></div></section>`;
}
function wireAccountsSettings(page) {
  const list = page.querySelector(".acc-list");
  if (!list) return;
  const draw = () => {
    list.textContent = "";
    for (const acc of accounts.list) {
      const row = html("div", "acc-row");
      const text = html("div", "acc-text");
      text.append(html("b", "", accName(acc) + (acc.id === accounts.current ? " (you, now)" : "")), html("small", "", acc.email || "Not signed in with Google"));
      const tools = html("div", "acc-tools");
      const button = (label, fn) => { const b = html("button", "btn", label); b.addEventListener("click", fn); tools.append(b); };
      if (canUseGoogle && !acc.email) button("Sign in with Google", () => googleSignIn(acc));
      button(acc.pin ? "Change PIN" : "Set a PIN", async () => {
        const pin = await askText(page, `A PIN for ${accName(acc)} (4 to 12 digits)`, "");
        if (pin == null) return;
        if (!/^\d{4,12}$/.test(pin)) return alertIn(page, "A PIN is 4 to 12 digits.");
        await setPin(acc, pin); draw();
      });
      if (acc.pin) button("Remove PIN", async () => { await setPin(acc, ""); draw(); });
      if (acc.id !== accounts.current) button("Switch to it", () => switchAccount(acc.id));
      if (accounts.list.length > 1) button("Delete account", async () => { if (await deleteAccount(acc, page)) draw(); });
      row.append(avatar(acc, 40), text, tools);
      list.append(row);
    }
  };
  accountRedraws.add(draw);
  draw();
  page.querySelector('[data-a="add-google"]')?.addEventListener("click", async () => {
    const acc = { id: crypto.randomUUID(), name: "New account", email: "", photo: "", pin: "", ...(await newSpace()) };
    googleSignIn(acc, { fresh: true });
  });
  page.querySelector('[data-a="add-name"]').addEventListener("click", async () => {
    const name = await askText(page, "The new account's name", "");
    if (!name?.trim()) return;
    const acc = { id: crypto.randomUUID(), name: name.trim(), email: "", photo: "", pin: "", ...(await newSpace()) };
    accounts.list.push(acc);
    await accounts.save();
    draw();
  });
}

// Start: with more than one account, or a PIN, Aquaris starts on the lock screen
accountsReady = async () => {
  // Finish deleting the account that was in use before the switch
  if (accounts.pendingDelete) {
    const gone = accounts.list.find(a => a.id === accounts.pendingDelete);
    delete accounts.pendingDelete;
    if (gone && gone.id !== accounts.current) { await removeAccount(gone); notify({ app: "settings", title: "Account deleted", body: `${accName(gone)}'s account is gone from this device.`, from: "accounts" }); }
    else await accounts.save();
  }
  const me = accounts.me();
  if (accounts.list.length > 1 || me?.pin) setTimeout(() => accountLock(), 2300);
  // Show who's signed in at the top of the Aquaris menu
  document.body.dataset.account = me?.id || "main";
};
accountShell = ev => { if (ev.type === "googleSignedIn") googleSignedIn(ev); };
window.Aquaris.googleSignedIn = who => googleSignedIn(who);
