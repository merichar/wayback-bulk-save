// web-ext settings. The add-on is unlisted and self-hosted (updates through
// updates.json), so lint checks it that way. The screenshots, release notes
// and update file aren't part of the package.
export default {
  ignoreFiles: ["images", "web-ext-config.mjs", "updates.json", "RELEASING.md"],
  lint: { selfHosted: true },
};
