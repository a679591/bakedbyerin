# catalog-manager

A sandboxed plugin for [EmDash CMS](https://emdashcms.com).

## Develop

```sh
npm install
npm run validate
npm run typecheck
npm run test
npm run build
```

To test against a running EmDash site, run `npm run dev` in this
directory (rebuilds on save) and `npm install file:../path/to/this`
in the site. Then `import catalogManager from "catalog-manager"` and pass
it into `emdash({ sandboxed: [catalogManager] })`.

`npm run test` builds the plugin and runs its tests through Worker Loader using
EmDash's production sandbox wrapper and host bridge.

## Publish

```sh
npm run login -- alice.example.com
npm run publish          # builds and uploads artifacts to your PDS
```

To publish from GitHub Actions, run `npm run release:setup`. The command
creates one shared workflow at the Git repository root.

## Version bumps

Bump `version` in `package.json` when you ship a release. The
scaffold's `emdash-plugin.jsonc` deliberately omits `version` —
the build pipeline reads it from `package.json` so there's a single
source of truth. **Bump major** for breaking changes, **bump minor**
for new routes or hooks, **bump patch** for fixes.

You MUST bump version whenever you change `capabilities`, `allowedHosts`,
or `storage` in the manifest. Installed users have consented to the
old trust contract; a change without a version bump would let new
behaviour slip past consent.
