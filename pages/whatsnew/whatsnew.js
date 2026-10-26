const params = new URLSearchParams(location.search);
const current = params.get("v") || CHANGELOG[0].version;
const from = params.get("from");
const $ = sel => document.querySelector(sel);

const entry = CHANGELOG.find(c => c.version === current) || CHANGELOG[0];

if (!from) {
  $("#kicker").textContent = "Welcome to";
  $("#headline").textContent = "Aero Browser " + current;
} else {
  $("#kicker").textContent = `Updated from ${from} to ${current}`;
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

for (const c of CHANGELOG.filter(c => c !== entry)) {
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
