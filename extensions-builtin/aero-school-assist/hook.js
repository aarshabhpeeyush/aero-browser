// School Assist, part 1 (runs inside the 21K School page).
// The school site loads your timetable, assignments and messages as data in the background.
// This passes a copy of that data to School Assist (bridge.js). It only listens; it never sends
// anything to the school or changes what the page does.
(() => {
  if (window.__schoolAssistListening) return;
  window.__schoolAssistListening = true;
  const WATCH = /\/api\?\/(notifications\/|overview\/basic\/|messages\/box\/in\/|calendar\/get_events\/|groups\/[^/&?]+\/)/;
  const pass = (url, data) => window.postMessage({ source: "school-assist", url, data }, location.origin);

  const realFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await realFetch.apply(this, args);
    try {
      const url = res.url || String(args[0]?.url || args[0]);
      if (res.ok && WATCH.test(url)) res.clone().json().then(d => pass(url, d), () => {});
    } catch {}
    return res;
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__schoolAssistUrl = String(url);
    return open.call(this, method, url, ...rest);
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        const url = this.responseURL || this.__schoolAssistUrl;
        if (this.status !== 200 || !WATCH.test(url)) return;
        pass(url, this.responseType === "json" ? this.response : JSON.parse(this.responseText));
      } catch {}
    });
    return send.apply(this, args);
  };
})();
