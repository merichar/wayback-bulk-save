// Wayback Bulk Save: adds a panel to https://web.archive.org/save that submits
// a list of addresses to Save Page Now one at a time, with the signed-in
// session, waits for each capture to finish, then pauses before the next.
// The list and each address's result are kept in extension storage, so a
// reload picks up where it stopped.
(function () {
  "use strict";
  const KEY = "wbs-state";
  const store = browser.storage.local;
  // options: the panel's own (pause, skip-if-saved-within); form: which of
  // the Save page's own checkboxes are checked, by name
  let state = { items: [], options: { within: "", delay: 20 }, form: null };
  let running = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const save = () => store.set({ [KEY]: state });

  // The panel
  const panel = document.createElement("section");
  panel.id = "wbs-panel";
  panel.innerHTML = `
    <h2>Wayback Bulk Save</h2>
    <p>Paste one address per line. Each is saved in turn with your signed-in session and the options checked in the Save form below, which are remembered; the next starts after the last capture finishes and the pause.</p>
    <textarea id="wbs-list" spellcheck="false" placeholder="https://www.example.edu/page.html"></textarea>
    <div class="wbs-row">
      <label><input type="checkbox" id="wbs-mine"> Also Save in My Web Archive</label>
      <label>Skip if Saved Within <input type="text" id="wbs-within" size="4" placeholder="1d"></label>
      <label>Pause <input type="number" id="wbs-delay" min="5" step="1"> Seconds</label>
    </div>
    <div class="wbs-row">
      <button type="button" id="wbs-start">Start</button>
      <button type="button" id="wbs-stop" disabled>Stop</button>
      <button type="button" id="wbs-retry">Retry Errors</button>
      <button type="button" id="wbs-clear">Clear List</button>
      <span id="wbs-summary" role="status"></span>
    </div>
    <table><thead><tr><th>Address</th><th>Status</th></tr></thead><tbody id="wbs-rows"></tbody></table>`;
  (document.querySelector("main, #content, body") || document.body).prepend(panel);
  const $ = (id) => panel.querySelector("#" + id);

  function render() {
    const rows = $("wbs-rows");
    rows.replaceChildren(
      ...state.items.map((it) => {
        const tr = document.createElement("tr");
        const a = document.createElement("td");
        a.textContent = it.url;
        const s = document.createElement("td");
        s.className =
          it.status === "success" ? "wbs-success" : it.status === "error" ? "wbs-error" : it.status === "queued" ? "" : "wbs-working";
        if (it.status === "success" && it.timestamp) {
          const link = document.createElement("a");
          link.href = `https://web.archive.org/web/${it.timestamp}/${it.url}`;
          link.textContent = `Saved ${it.timestamp}`;
          link.target = "_blank";
          s.append(link);
          if (it.mine) s.append(` (${it.mine})`);
        } else s.textContent = it.status + (it.message ? `: ${it.message}` : "");
        tr.append(a, s);
        return tr;
      }),
    );
    const count = (st) => state.items.filter((i) => i.status === st).length;
    $("wbs-summary").textContent = state.items.length
      ? `${count("success")} saved, ${count("error")} errors, ${count("queued")} waiting of ${state.items.length}`
      : "";
    $("wbs-start").disabled = running;
    $("wbs-stop").disabled = !running;
  }

  // The Save page's own form and its checkboxes
  const form = document.getElementById("web-save-form");
  const boxes = () => (form ? [...form.querySelectorAll('input[type="checkbox"][name]')] : []);
  // "Also Save in My Web Archive": the panel's box and the Save form's own
  // (wm-save-mywebarchive) stay in step
  const formMine = () => form && form.querySelector('[name="wm-save-mywebarchive"]');
  function readOptions() {
    state.options = {
      mine: $("wbs-mine").checked,
      within: $("wbs-within").value.trim(),
      delay: Math.max(5, Number($("wbs-delay").value) || 20),
    };
    state.form = Object.fromEntries(boxes().map((b) => [b.name, b.checked]));
  }
  function showOptions() {
    $("wbs-within").value = state.options.within || "";
    $("wbs-mine").checked = !!state.options.mine;
    if (formMine()) formMine().checked = !!state.options.mine;
    $("wbs-delay").value = state.options.delay || 20;
    if (state.form) for (const b of boxes()) if (b.name in state.form) b.checked = state.form[b.name];
  }
  // Remember the form's checkboxes as soon as they change
  for (const b of boxes())
    b.addEventListener("change", () => {
      if (b === formMine()) $("wbs-mine").checked = b.checked;
      readOptions();
      save();
    });
  $("wbs-mine").addEventListener("change", () => {
    if (formMine()) formMine().checked = $("wbs-mine").checked;
    readOptions();
    save();
  });

  // What the progress page does when its "Save also in my web archive" box is
  // checked and the capture succeeds (bundle-spn.js)
  async function addToMine(url, timestamp) {
    try {
      const res = await fetch("/__wb/web-archive/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, snapshot: timestamp, tags: [] }),
      });
      if (res.status === 401) return "not added to My Web Archive: signed out";
      return res.ok ? "added to My Web Archive" : `not added to My Web Archive: HTTP ${res.status}`;
    } catch (e) {
      return `not added to My Web Archive: ${e}`;
    }
  }

  // Adds new addresses from the box to the list; keeps results for ones
  // already there
  function loadList() {
    const seen = new Set(state.items.map((i) => i.url));
    for (const line of $("wbs-list").value.split(/\s+/)) {
      const url = line.trim();
      if (/^https?:\/\//i.test(url) && !seen.has(url)) {
        state.items.push({ url, status: "queued" });
        seen.add(url);
      }
    }
    $("wbs-list").value = "";
  }

  // Posts the way the Save page's own form does (bundle-spn.js points the
  // form at /save/<address>). The answer is JSON when Save Page Now gives it,
  // or its progress page, which starts watchJob("<job id>"); either way, the
  // job id is what's needed.
  async function submit(item) {
    const o = state.options;
    // Exactly what the Save form would send, with this address in it
    const body = new URLSearchParams(form ? new FormData(form) : undefined);
    body.set("url", item.url);
    if (o.within) body.set("if_not_archived_within", o.within);
    const res = await fetch("/save/" + item.url, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (res.status === 429) return { retryAfter: 60 };
    if (res.status === 401) return { error: "Signed out; sign in at archive.org and choose Retry Errors" };
    const text = await res.text();
    let job;
    try {
      const json = JSON.parse(text);
      if (json.job_id) job = json.job_id;
      else if (json.message) return { error: json.message };
    } catch {
      job = (text.match(/watchJob\(\s*["']([^"']+)["']/) || text.match(/(spn2-[0-9a-f]+)/) || [])[1];
    }
    if (!job) return { error: `HTTP ${res.status}, no job started (signed in?)` };
    return { job };
  }

  async function watch(job) {
    for (let i = 0; i < 120 && running; i++) {
      await sleep(5000);
      const res = await fetch(`/save/status/${job}?_t=${Date.now()}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (res.status === 429) {
        await sleep(30000);
        continue;
      }
      if (res.status === 401) return { error: "Signed out; sign in at archive.org and choose Retry Errors" };
      const s = await res.json().catch(() => ({}));
      if (s.status === "success") return { timestamp: s.timestamp };
      if (s.status === "error") return { error: s.message || s.status_ext || "error" };
    }
    return running ? { error: "Timed out waiting for the capture" } : { stopped: true };
  }

  async function run() {
    running = true;
    render();
    for (const item of state.items) {
      if (!running) break;
      if (item.status !== "queued") continue;
      let tries = 0;
      for (;;) {
        item.status = "submitting";
        item.message = "";
        render();
        let r;
        try {
          r = await submit(item);
        } catch (e) {
          r = { error: String(e) };
        }
        if (r.retryAfter && tries++ < 3 && running) {
          item.status = "waiting";
          item.message = "Save Page Now asked us to slow down; trying again in a minute";
          render();
          await sleep(r.retryAfter * 1000);
          continue;
        }
        if (r.error || r.retryAfter) {
          item.status = "error";
          item.message = r.error || "Rate limited";
          break;
        }
        item.status = "capturing";
        item.job = r.job;
        render();
        const w = await watch(r.job);
        if (w.stopped) {
          item.status = "queued";
        } else if (w.error) {
          item.status = "error";
          item.message = w.error;
        } else {
          item.status = "success";
          item.timestamp = w.timestamp;
          if (state.options.mine) item.mine = await addToMine(item.url, w.timestamp);
        }
        break;
      }
      await save();
      render();
      if (running && state.items.some((i) => i.status === "queued")) await sleep(state.options.delay * 1000);
    }
    running = false;
    await save();
    render();
  }

  $("wbs-start").addEventListener("click", async () => {
    readOptions();
    loadList();
    await save();
    render();
    if (!running) run();
  });
  $("wbs-stop").addEventListener("click", () => {
    running = false;
    render();
  });
  $("wbs-retry").addEventListener("click", async () => {
    for (const i of state.items) if (i.status === "error") Object.assign(i, { status: "queued", message: "" });
    await save();
    render();
  });
  $("wbs-clear").addEventListener("click", async () => {
    if (running) return;
    state.items = [];
    await save();
    render();
  });

  store.get(KEY).then((got) => {
    if (got[KEY]) state = got[KEY];
    // Anything mid-flight when the page closed goes back in the queue
    for (const i of state.items) if (!["success", "error", "queued"].includes(i.status)) i.status = "queued";
    showOptions();
    render();
  });
})();
