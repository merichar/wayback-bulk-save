# Releasing

The add-on is signed by Mozilla as an unlisted add-on and installed from
GitHub. Firefox checks `updates.json` (the manifest's `update_url`) for new
versions.

1. Set the new version in `manifest.json` and commit "chore: release X.Y.Z".
2. Tag it with the bare number (`git tag -a X.Y.Z -m "Wayback Bulk Save X.Y.Z"`)
   and push the branch and the tag.
3. Build: `npx web-ext build`. The zip is in `web-ext-artifacts/`.
4. Upload the zip at https://addons.mozilla.org/developers/ as a new version
   (On Your Own, unlisted) and download the signed `.xpi`.
5. Name it `wayback_bulk_save-X.Y.Z.xpi` and attach it to a GitHub release
   for the tag: `gh release create X.Y.Z wayback_bulk_save-X.Y.Z.xpi`.
6. Add the version to `updates.json`, with its `update_link` pointing to that
   release asset, and push. Installed copies update within a day.

Keep older versions in `updates.json`; Firefox uses the newest one it can
install. If the add-on is ever listed on addons.mozilla.org, drop
`update_url` from the manifest, since listed add-ons update through Mozilla.
