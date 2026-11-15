# Wayback Bulk Save

A small Firefox add-on that saves a list of addresses to the Wayback Machine
one at a time. It adds a collapsible "Save a List of Addresses" under the address box on https://web.archive.org/save and submits
each address with your signed-in session, waits for that capture to finish,
pauses, then moves to the next. The list and each address's result are kept,
so a reload or a closed tab picks up where it stopped.

It's unofficial: not made by or affiliated with the Internet Archive. The
Wayback Machine's own extension once had a Bulk Save page; it's no longer
offered.

## Load It

1. In Firefox, open `about:debugging#/runtime/this-firefox`.
2. Choose Load Temporary Add-on and pick this folder's `manifest.json`.

A temporary add-on lasts until Firefox restarts. To keep it, package it with
`npx web-ext build` and sign it through addons.mozilla.org as an unlisted
add-on.

## Use It

1. Sign in at archive.org.
2. Open https://web.archive.org/save and open Save a List of Addresses under
   the address box.
3. Paste one address per line, set the options and choose Start.

- **Save Outlinks** also saves what each page links to and loads (its
  stylesheets, scripts and images).
- **Save Error Pages** saves a page even if it answers with an error.
- **Skip if Saved Within** skips anything saved recently, such as `1d` or
  `12h`.
- **Pause** is the wait between captures, 20 seconds by default. Save Page
  Now limits how fast one account can save; if it asks to slow down, the
  add-on waits a minute and tries again.

Stop pauses the queue; Start resumes it. Retry Errors puts failed addresses
back in the queue.

## Privacy

The add-on only runs on https://web.archive.org/save. It sends your list to
Save Page Now with your own signed-in session, exactly as the Save form
would, and keeps the list and results in the browser's extension storage. It
collects nothing and sends nothing anywhere else.

## Be Kind to Save Page Now

Save Page Now is a free service with limits on how fast one account can save.
Keep the pause at 20 seconds or more, and use Skip if Saved Within to avoid
saving the same page again.

## License

MIT
