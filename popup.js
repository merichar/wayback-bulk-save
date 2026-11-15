// The toolbar popup: edits the list and options, and draws the queue the
// background script runs. Closing the popup doesn't stop anything.
"use strict";

const KEY = "wbs-state";
const $ = (id) => document.getElementById(id);
const send = (msg) => browser.runtime.sendMessage(msg);
const boxes = [...document.querySelectorAll('#options input[type="checkbox"][name]')];
let running = false;

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
    : "Ready";
  // One button: SAVE PAGES, or STOP while the queue runs
  running = !!state.running;
  $("start").textContent = running ? "Stop" : "Save Pages";
  $("retry").hidden = !count("error");
  $("clear").hidden = running || !count("success", "skipped", "error");

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

$("start").addEventListener("click", async () => {
  if (running) return send({ type: "stop" });
  const urls = $("list").value.split(/\s+/).filter(Boolean);
  if (urls.length) await send({ type: "add", urls });
  $("list").value = "";
  send({ type: "start" });
});
// Closes only the dialog window the add-on opened (the background script
// knows its id); never the browser window. Anywhere else, just this page.
$("close").addEventListener("click", async () => {
  const closed = await send({ type: "closeDialog" }).catch(() => false);
  if (!closed) window.close();
});
$("retry").addEventListener("click", () => send({ type: "retry" }));
$("clear").addEventListener("click", () => send({ type: "clear" }));

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
