// Aquaris accounts: a desktop for each person, signed in with their Google account (or just a name).
// Each account has its own settings and its own website sign-ins, so signing in with Google here
// also signs that person into Gmail, YouTube and Docs in their own account only. Passwords are only
// ever typed into Google's own page. The lock screen picks the account (with an optional PIN).

// ----- Who's signed in to Google, in an account's own space -----
// Google's account list page (the one browsers use to show who's signed in) gives the name, email
// and photo. On a computer Aquaris asks for it with that account's cookies; the iPad app asks for it
// in that account's storage.
function parseGoogleAccounts(text) {
  try {
    const data = JSON.parse(text);
    const found = [];
    const walk = a => {
      if (!Array.isArray(a)) return;
      const email = a.find(x => typeof x === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
      if (email && a.length > 4) {
        const i = a.indexOf(email);
        found.push({ email, name: typeof a[i - 1] === "string" ? a[i - 1] : email.split("@")[0], photo: typeof a[i + 1] === "string" && a[i + 1].startsWith("http") ? a[i + 1] : "" });
        return;
      }
      a.forEach(walk);
    };
    walk(data);
    return found[0] || null;
  } catch { return null; }
}
const GOOGLE_LIST = "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard";
let googleWhoWait = null;
async function googleWho(account) {
  if (inChrome) {
    const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
    const uri = Services.io.newURI(GOOGLE_LIST);
    const principal = Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI("https://accounts.google.com/"), { userContextId: account.ctx || 0 });
    const channel = NetUtil.newChannel({ uri, loadingPrincipal: principal, securityFlags: Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL, contentPolicyType: Ci.nsIContentPolicy.TYPE_OTHER });
    const text = await new Promise(resolve => NetUtil.asyncFetch(channel, (stream, status) => {
      if (!Components.isSuccessCode(status)) return resolve("");
      try { resolve(NetUtil.readInputStreamToString(stream, stream.available(), { charset: "UTF-8" })); } catch { resolve(""); }
    }));
    return parseGoogleAccounts(text);
  }
  if (inShell) {
    const text = await new Promise(resolve => {
      googleWhoWait = resolve;
      shell.postMessage({ cmd: "googleWho", store: account.store || "" });
      setTimeout(() => { if (googleWhoWait === resolve) { googleWhoWait = null; resolve(""); } }, 10000);
    });
    return parseGoogleAccounts(text);
  }
  return null;
}
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
      if (acc.ctx) {
        Services.clearData.deleteDataFromOriginAttributesPattern({ userContextId: acc.ctx });
        const { ContextualIdentityService } = containerService();
        ContextualIdentityService.remove(acc.ctx);
      }
      await IOUtils.remove(PathUtils.join(PathUtils.profileDir, `aquaris-${acc.id}.json`), { ignoreAbsent: true });
    } catch (e) { console.error("Aquaris account:", e); }
  } else {
    if (inShell && acc.store) shell.postMessage({ cmd: "removeStore", store: acc.store });
    if (inShell) shell.postMessage({ cmd: "save", key: accounts.key(acc.id), data: "{}" });
    try { localStorage.removeItem(accounts.key(acc.id)); } catch {}
  }
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
  const started = Date.now();
  const check = async () => {
    if (!wins.includes(win)) {
      // Closed before signing in: a new account that never signed in is taken away again
      if (fresh && !acc.email) await removeAccount(acc);
      return drawAccountsAgain();
    }
    const who = await googleWho(acc).catch(() => null);
    if (who?.email) {
      Object.assign(acc, { name: acc.name && acc.name !== "New account" ? acc.name : who.name, email: who.email, photo: who.photo });
      if (!accounts.list.includes(acc)) accounts.list.push(acc);
      await accounts.save();
      closeWin(win);
      notify({ app: "settings", title: "Signed in with Google", body: `${who.name} (${who.email}) has an Aquaris account now.`, from: "accounts" });
      drawAccountsAgain();
      if (acc.id !== accounts.current && await askYes($("#desktop"), `Switch to ${who.name}'s desktop now?`)) switchAccount(acc.id);
      return;
    }
    if (Date.now() - started < 20 * 60000) setTimeout(check, 2500);
  };
  setTimeout(check, 4000);
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
      if (acc.id !== "main" && acc.id !== accounts.current) button("Remove", async () => {
        if (await askYes(page, `Remove ${accName(acc)}'s account? Its desktop, settings and website sign-ins on this device are deleted.`)) { await removeAccount(acc); draw(); }
      });
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
accountsReady = () => {
  const me = accounts.me();
  if (accounts.list.length > 1 || me?.pin) setTimeout(() => accountLock(), 2300);
  // Show who's signed in at the top of the Aquaris menu
  document.body.dataset.account = me?.id || "main";
};
accountShell = ev => { if (ev.type === "googleWho" && googleWhoWait) { const done = googleWhoWait; googleWhoWait = null; done(ev.text || ""); } };
