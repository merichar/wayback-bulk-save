// Wayback Bulk Save: runs the queue in the background, so it keeps going
// after the popup closes. Each address goes to Save Page Now with the
// signed-in session (the same requests the Wayback Machine's own extension
// and Save page make), the capture is watched to the end, then a pause
// before the next. State lives in extension storage; the popup draws it.
"use strict";

const HOST = "https://web.archive.org/";
const KEY = "wbs-state";
const store = browser.storage.local;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The Save form's own options (name: default); the popup shows these
const FORM_OPTIONS = {
  capture_outlinks: false,
  capture_all: true,
  capture_screenshot: false,
  disable_adblocker: false,
  "wm-save-mywebarchive": false,
  email_result: false,
  wacz: false,
};
// The shortest wait between saves, and the default; Save Page Now is a free
// service, so the add-on never goes faster than this
const MIN_DELAY = 20;
const DEFAULTS = { items: [], form: { ...FORM_OPTIONS }, within: "", delay: MIN_DELAY, running: false };

let state = { ...DEFAULTS };
// The dialog window's id, once the toolbar button has opened it
let dialog = null;
let running = false;

async function load() {
  const got = (await store.get(KEY))[KEY] || {};
  state = { ...DEFAULTS, ...got, form: { ...FORM_OPTIONS, ...(got.form || {}) } };
  // Anything mid-flight when Firefox closed goes back in the queue
  for (const i of state.items) if (!["success", "skipped", "error", "queued"].includes(i.status)) i.status = "queued";
  state.running = false;
}
const save = () => store.set({ [KEY]: state });

function badge() {
  const left = state.items.filter((i) => !["success", "skipped", "error"].includes(i.status)).length;
  browser.browserAction.setBadgeText({ text: running && left ? String(left) : "" });
  browser.browserAction.setBadgeBackgroundColor({ color: "#2a7a3b" });
}
async function update() {
  state.running = running;
  await save();
  badge();
}

// Signed in to archive.org? The same cookie the official extension checks
async function signedIn() {
  const cookies = await browser.cookies.getAll({ url: "https://archive.org" });
  return cookies.some((c) => c.name === "logged-in-sig" && c.value);
}

// "merichar.org" or "www.cmu.edu/page" become https:// addresses; anything
// that isn't a web address gives null
function normalize(raw) {
  let text = String(raw).trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = "https://" + text;
  try {
    const u = new URL(text);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.href;
  } catch {
    return null;
  }
}

async function submit(url) {
  const body = new URLSearchParams();
  for (const [name, on] of Object.entries(state.form)) {
    if (!on || name === "wm-save-mywebarchive") continue;
    body.set(name, name === "capture_outlinks" ? "1" : "on");
  }
  if (state.within) body.set("if_not_archived_within", state.within);
  body.set("url", url);
  const res = await fetch(HOST + "save/", {
    method: "POST",
    credentials: "include",
    signal: AbortSignal.timeout(60000),
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (res.status === 429) return { retryAfter: Number(res.headers.get("Retry-After")) || 60 };
  if (res.status === 401) return { error: "Signed out; sign in at archive.org, then Retry Errors" };
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    const job = (text.match(/spn2-[a-z0-9-]+/) || [])[0];
    return job ? { job } : { error: `HTTP ${res.status}, no capture started` };
  }
  // Saved recently: Save Page Now says so in the message, with or without a
  // job id ("The same snapshot had been made 51 minutes ago. You can make a
  // new capture of this URL after 1 hour."), and no new capture happens
  if (json.message && /same snapshot|already been captured|after \d+ (hour|minute)/i.test(json.message))
    return { skipped: json.message };
  if (json.job_id) return { job: json.job_id, note: json.message };
  if (dailyLimit(json)) return { daily: json.message || "Save Page Now's daily limit for this account" };
  return { error: json.message || `HTTP ${res.status}, no capture started` };
}

// Save Page Now's answer when the account has used up today's captures
function dailyLimit(json) {
  return /daily|too-many-daily|captures today|tomorrow/i.test(`${json.status_ext || ""} ${json.message || ""}`);
}

async function watch(job) {
  let wait = 6000;
  for (let i = 0; i < 150 && running; i++) {
    await sleep(wait);
    let res;
    try {
      res = await fetch(`${HOST}save/status/${job}?_t=${Date.now()}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      // A dropped connection or a slow answer: check again next time
      wait = 10000;
      continue;
    }
    const retry = Number(res.headers.get("Retry-After"));
    wait = retry ? retry * 1000 : 6000;
    if (res.status === 429) continue;
    if (res.status === 401) return { error: "Signed out; sign in at archive.org, then Retry Errors" };
    const s = await res.json().catch(() => ({}));
    if (s.status === "success") return { timestamp: s.timestamp };
    if (s.status === "error" && dailyLimit(s)) return { daily: s.message || s.status_ext };
    if (s.status === "error") return { error: s.message || s.status_ext || "Capture failed" };
  }
  return running ? { error: "Timed out waiting for the capture" } : { stopped: true };
}

async function addToMine(url, timestamp) {
  try {
    const res = await fetch(HOST + "__wb/web-archive", {
      method: "POST",
      credentials: "include",
      signal: AbortSignal.timeout(30000),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ url, snapshot: timestamp, tags: [] }),
    });
    return res.ok ? "added to My Web Archive" : `not added to My Web Archive (HTTP ${res.status})`;
  } catch (e) {
    return `not added to My Web Archive (${e})`;
  }
}

async function run() {
  if (running) return;
  running = true;
  try {
    await runQueue();
  } catch (e) {
    console.error("Wayback Bulk Save stopped:", e);
  } finally {
    // Whatever happens, the queue isn't left marked as running
    running = false;
    for (const i of state.items) if (["submitting", "capturing", "waiting"].includes(i.status)) i.status = "queued";
    await update();
  }
}

async function runQueue() {
  await update();
  for (const item of state.items) {
    if (!running) break;
    if (item.status !== "queued") continue;
    let tries = 0;
    for (;;) {
      Object.assign(item, { status: "submitting", message: "" });
      await update();
      let r;
      try {
        r = await submit(item.url);
      } catch (e) {
        r = { error: String(e) };
      }
      // Asked to slow down: wait a minute, then two, then four (or longer if
      // Save Page Now says so), and give up on this page after that
      if (r.retryAfter && tries < 3 && running) {
        const wait = Math.max(r.retryAfter, 60 * 2 ** tries);
        tries++;
        Object.assign(item, { status: "waiting", message: `Save Page Now asked to slow down, so trying again in ${Math.round(wait / 60)} min.` });
        await update();
        await sleep(wait * 1000);
        continue;
      }
      // Today's limit is used up: put the page back and stop the queue
      if (r.daily) {
        Object.assign(item, { status: "queued", message: `Stopped: ${r.daily}` });
        running = false;
        break;
      }
      if (r.skipped) {
        Object.assign(item, { status: "skipped", message: r.skipped });
        break;
      }
      if (r.error || r.retryAfter) {
        Object.assign(item, { status: "error", message: r.error || "Save Page Now kept asking to slow down. Choose Retry Errors later." });
        break;
      }
      Object.assign(item, { status: "capturing", job: r.job, message: r.note || "" });
      await update();
      const w = await watch(r.job);
      if (w.daily) {
        Object.assign(item, { status: "queued", message: `Stopped: ${w.daily}` });
        running = false;
      } else if (w.stopped) item.status = "queued";
      else if (w.error) Object.assign(item, { status: "error", message: w.error });
      else {
        Object.assign(item, { status: "success", timestamp: w.timestamp, message: "" });
        if (state.form["wm-save-mywebarchive"]) item.message = await addToMine(item.url, w.timestamp);
      }
      break;
    }
    await update();
    if (running && state.items.some((i) => i.status === "queued")) await sleep(Math.max(MIN_DELAY, state.delay) * 1000);
  }
}

// Messages from the popup
browser.runtime.onMessage.addListener(async (msg) => {
  switch (msg.type) {
    case "add": {
      // A new address joins the queue; one that already finished (saved,
      // skipped or failed) goes back in it for another save. Answers with
      // what happened, so the dialog can say so.
      const result = { added: 0, again: 0, already: 0, bad: [] };
      for (const raw of msg.urls) {
        const url = normalize(raw);
        if (!url) {
          result.bad.push(raw);
          continue;
        }
        const old = state.items.find((i) => i.url === url);
        if (!old) {
          state.items.push({ url, status: "queued" });
          result.added++;
        } else if (["success", "skipped", "error"].includes(old.status)) {
          Object.assign(old, { status: "queued", message: "", timestamp: undefined, job: undefined });
          result.again++;
        } else result.already++;
      }
      await update();
      return result;
    }
    case "options":
      Object.assign(state, { form: { ...state.form, ...msg.form }, within: msg.within, delay: msg.delay });
      break;
    case "start":
      run();
      return;
    case "stop":
      running = false;
      break;
    case "retry":
      for (const i of state.items) if (i.status === "error") Object.assign(i, { status: "queued", message: "" });
      break;
    case "clear":
      if (running) return;
      state.items = state.items.filter((i) => i.status === "queued");
      if (msg.all) state.items = [];
      break;
    case "signedIn":
      return signedIn();
    case "closeDialog": {
      // Only the window this script created, and only if it's a popup window
      if (dialog === null) return false;
      const win = await browser.windows.get(dialog).catch(() => null);
      if (!win || win.type !== "popup") return false;
      await browser.windows.remove(dialog);
      return true;
    }
  }
  await update();
});

// The toolbar button opens the dialog as its own small window (a desktop
// window, so its corners are square), or brings it forward if it's open
browser.browserAction.onClicked.addListener(async () => {
  if (dialog !== null) {
    try {
      await browser.windows.update(dialog, { focused: true });
      return;
    } catch {
      dialog = null;
    }
  }
  const win = await browser.windows.create({ url: "popup.html", type: "popup", width: 520, height: 820 });
  dialog = win.id;
});
browser.windows.onRemoved.addListener((id) => {
  if (id === dialog) dialog = null;
});

load().then(update);
