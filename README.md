# Wayback Bulk Save

A small Firefox add-on that saves a list of addresses to the Wayback Machine
one at a time. Its toolbar button opens a small window with the list and Save
Page Now's options; it submits each address with your signed-in archive.org
session, waits for that capture to finish, pauses, then moves to the next.
The queue runs in the background, so you can close the window, and the list
and results are kept if Firefox restarts.

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

1. Sign in at archive.org. The window says whether you're signed in.
2. Click the toolbar button to open the window, paste one address per line, set the options and
   choose Save Pages. The button's badge counts what's left.

- **Save Outlinks** also saves what each page links to and loads (its
  stylesheets, scripts and images).
- **Save Error Pages** saves a page even if it answers with an error.
- **Also Save in My Web Archive** adds each snapshot to your My Web Archive.
- **Email Me the Results** and the WACZ file send one email per address.
- **Skip if Saved Within** skips anything saved recently, such as `1d` or
  `12h`.
- **Pause** is the wait between captures, 20 seconds by default. Save Page
  Now limits how fast one account can save; if it asks to slow down, the
  add-on waits and tries again.

While it runs, Save Pages reads Stop; choosing Save Pages again resumes. Retry
Errors puts failed addresses back in the queue, and Clear Done removes
finished ones.

## Privacy

The add-on talks only to web.archive.org (Save Page Now and My Web Archive)
with your own signed-in session, and reads archive.org's sign-in cookie to
show whether you're signed in. It keeps the list and results in the
browser's extension storage. It collects nothing and sends nothing anywhere
else.

## Be Kind to Save Page Now

Save Page Now is a free service with limits on how fast one account can save.
Keep the pause at 20 seconds or more, and use Skip if Saved Within to avoid
saving the same page again.

## License

MIT
