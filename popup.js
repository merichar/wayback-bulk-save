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
  $("open").hidden = running;
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

// Adds what's in the box, says what happened, then starts. Lines that
// aren't web addresses stay in the box.
$("start").addEventListener("click", async () => {
  if (running) return send({ type: "stop" });
  const lines = $("list").value.split(/\s+/).filter(Boolean);
  if (lines.length) {
    const r = await send({ type: "add", urls: lines });
    const said = [];
    if (r.added) said.push(`Added ${r.added}`);
    if (r.again) said.push(`queued ${r.again} again`);
    if (r.already) said.push(`${r.already} already in the queue`);
    if (r.bad.length) said.push(`${r.bad.length} not a web address (left in the box)`);
    $("message").textContent = said.join(", ") + ".";
    $("list").value = r.bad.join("\n");
    if (!r.added && !r.again) return;
  }
  send({ type: "start" });
});
// Closes only the dialog window the add-on opened (the background script
// knows its id); never the browser window. Anywhere else, just this page.
// Open List... (or a file dropped on the box): reads a text, CSV or TSV file
// and puts the addresses in it into the box, one per line, for a look before
// Save Pages. In a CSV, any cell that looks like an address counts.
function addresses(text) {
  const found = [];
  for (const cell of text.split(/[\s,;\t"']+/)) {
    if (/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(cell) || /^https?:\/\//i.test(cell)) found.push(cell);
  }
  return [...new Set(found)];
}
async function loadFile(file) {
  if (!file) return;
  const found = addresses(await file.text());
  const box = $("list");
  box.value = [box.value.trim(), ...found].filter(Boolean).join("\n");
  $("message").textContent = found.length
    ? `Read ${found.length} ${found.length === 1 ? "address" : "addresses"} from ${file.name}. Choose Save Pages to start.`
    : `No web addresses found in ${file.name}.`;
}
$("open").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", () => {
  loadFile($("file").files[0]);
  $("file").value = "";
});
$("list").addEventListener("dragover", (e) => e.preventDefault());
$("list").addEventListener("drop", (e) => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  loadFile(e.dataTransfer.files[0]);
});

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
