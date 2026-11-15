// The toolbar popup: edits the list and options, and draws the queue the
// background script runs. Closing the popup doesn't stop anything.
"use strict";

const KEY = "wbs-state";
const $ = (id) => document.getElementById(id);
const send = (msg) => browser.runtime.sendMessage(msg);
const boxes = [...document.querySelectorAll('#options input[type="checkbox"][name]')];

function draw(state) {
  if (!state) return;
  for (const b of boxes) b.checked = !!state.form[b.name];
  if (document.activeElement !== $("within")) $("within").value = state.within || "";
  if (document.activeElement !== $("delay")) $("delay").value = state.delay || 20;

  const items = state.items || [];
  const count = (...st) => items.filter((i) => st.includes(i.status)).length;
  const left = items.length - count("success", "skipped", "error");
  $("summary").textContent = items.length
    ? `${count("success")} saved, ${count("skipped")} skipped, ${count("error")} ${count("error") === 1 ? "error" : "errors"}, ${left} to go${state.running ? " (running)" : ""}`
    : "No addresses yet.";
  $("start").disabled = state.running || !count("queued");
  $("stop").disabled = !state.running;
  $("retry").disabled = !count("error");
  $("clear").disabled = state.running || !count("success", "skipped", "error");

  $("items").replaceChildren(
    ...items.map((it) => {
      const li = document.createElement("li");
      li.append(it.url);
      const s = document.createElement("span");
      s.className =
        "status " +
        (["success", "skipped", "error"].includes(it.status) ? it.status : it.status === "queued" ? "" : "working");
      if (it.status === "success") {
        const a = document.createElement("a");
        a.href = `https://web.archive.org/web/${it.timestamp}/${it.url}`;
        a.target = "_blank";
        a.textContent = `Saved ${it.timestamp}`;
        s.append(a, it.message ? `, ${it.message}` : "");
      } else s.textContent = it.status + (it.message ? `: ${it.message}` : "");
      li.append(s);
      return li;
    }),
  );
}

function sendOptions() {
  send({
    type: "options",
    form: Object.fromEntries(boxes.map((b) => [b.name, b.checked])),
    within: $("within").value.trim(),
    delay: Math.max(5, Number($("delay").value) || 20),
  });
}
for (const b of boxes) b.addEventListener("change", sendOptions);
$("within").addEventListener("change", sendOptions);
$("delay").addEventListener("change", sendOptions);

$("add").addEventListener("click", () => {
  const urls = $("list").value.split(/\s+/).filter(Boolean);
  if (urls.length) send({ type: "add", urls });
  $("list").value = "";
});
$("add-tab").addEventListener("click", async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) send({ type: "add", urls: [tab.url] });
});
$("start").addEventListener("click", () => {
  const urls = $("list").value.split(/\s+/).filter(Boolean);
  if (urls.length) send({ type: "add", urls });
  $("list").value = "";
  send({ type: "start" });
});
$("stop").addEventListener("click", () => send({ type: "stop" }));
$("retry").addEventListener("click", () => send({ type: "retry" }));
$("clear").addEventListener("click", () => send({ type: "clear" }));

// Keep the options section the way it was left
$("options").addEventListener("toggle", () => {
  try {
    localStorage.setItem("wbs-options-open", $("options").open ? "1" : "");
  } catch {}
});
try {
  $("options").open = !!localStorage.getItem("wbs-options-open");
} catch {}

browser.storage.local.get(KEY).then((got) => draw(got[KEY]));
browser.storage.onChanged.addListener((changes) => {
  if (changes[KEY]) draw(changes[KEY].newValue);
});

send({ type: "signedIn" }).then((ok) => {
  const p = $("signin");
  if (ok) p.textContent = "Signed in to archive.org.";
  else {
    p.textContent = "Not signed in. ";
    const a = document.createElement("a");
    a.href = "https://archive.org/account/login";
    a.target = "_blank";
    a.textContent = "Sign in at archive.org";
    p.append(a, " to save.");
  }
});
