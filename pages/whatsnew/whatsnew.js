const params = new URLSearchParams(location.search);
const current = params.get("v") || CHANGELOG[0].version;
const from = params.get("from");
const pretty = v => v.replace(/-beta\.(\d+)$/, " Beta $1"); // "1.0.0-beta.1" -> "1.0.0 Beta 1"
const app = params.get("app") || "Aero Browser"; // Aeris opens this page too
// Only this version and older ones (Aero and Aeris share this list).
const notNewer = v => { const a = v.split("-")[0].split(".").map(Number), b = current.split("-")[0].split(".").map(Number); for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0); return true; };
const $ = sel => document.querySelector(sel);

const entry = CHANGELOG.find(c => c.version === current) || CHANGELOG[0];

if (!from) {
  $("#kicker").textContent = "Welcome to";
  $("#headline").textContent = app + " " + pretty(current);
} else {
  $("#kicker").textContent = `Updated from ${from} to ${pretty(current)}`;
  $("#headline").textContent = entry.title;
}
$("#sub").textContent = from ? "Here's what's new in this version:" : "Here's what you can do:";

function card(item) {
  const el = document.createElement("article");
  el.className = "glass card";
  el.innerHTML = `<div class="icon"></div><h2></h2><p></p>`;
  el.querySelector(".icon").textContent = item.icon;
  el.querySelector("h2").textContent = item.title;
  el.querySelector("p").textContent = item.text;
  return el;
}

entry.items.forEach(item => $("#latest").append(card(item)));

for (const c of CHANGELOG.filter(c => c !== entry && notNewer(c.version))) {
  const block = document.createElement("div");
  block.className = "old-version";
  block.innerHTML = `<h3></h3><ul></ul>`;
  block.querySelector("h3").textContent = `${c.version} · ${c.title}`;
  for (const item of c.items) {
    const li = document.createElement("li");
    li.textContent = `${item.icon} ${item.title}: ${item.text}`;
    block.querySelector("ul").append(li);
  }
  $("#older").append(block);
}
