# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

Node.js/TypeScript metrics client (`goodmetrics-nodejs`) for the goodmetrics protocol and
OpenTelemetry-compatible backends. Published to npm.

## Commands

```bash
npm ci             # install (uses committed .npmrc, see below)
npm run build      # prebuild (eslint) + tsc — this is what CI runs
npm run lint       # eslint only
npm run format     # eslint --fix
```

There is no wired-up `test` script; `jest`/`ts-jest` are present as devDependencies but are not
invoked by any script or CI job. Don't assume `npm test` does anything meaningful.

## TypeScript / Node conventions

- `strict` mode is on in `tsconfig.json` — keep it that way. Avoid `any`; prefer precise types or
  generics.
- Prefer `async`/`await` over raw Promise chains.
- Exported/public functions should have explicit return types (`@typescript-eslint/explicit-module-boundary-types`
  is a lint warning, not an error, but new code should still have them — don't add to the pile of
  existing warnings).
- Non-null assertions (`!`) are discouraged (`@typescript-eslint/no-non-null-assertion`); narrow
  the type or handle the `undefined` case instead.
- Single quotes, semicolons required, no unused vars — enforced by ESLint/Prettier, run
  `npm run format` before committing.
- Keep dependencies minimal. Before bumping a dependency (including via Dependabot), check whether
  its shipped `.d.ts` requires a newer TypeScript than this repo's pinned `typescript` version —
  this has broken CI before (a `uuid` major bump required TS 5.0+ syntax the pinned TS 4.x/5.x
  toolchain couldn't parse). Verify with `npx tsc --noEmit` and `npm run lint` locally, not just
  `npm install` succeeding.

## Commit messages: Conventional Commits (required, not just style)

This repo uses `release-please` to automate versioning and changelogs from commit history on
`main`. Commit type directly determines the version bump, so this isn't just a style preference —
non-conforming commits either get silently ignored by release-please or produce the wrong bump:

- `fix: ...` → patch bump
- `feat: ...` → minor bump (this repo is pre-1.0 with default versioning-strategy, so `feat` bumps
  minor, not patch)
- `feat!: ...` or a `BREAKING CHANGE:` footer → major-equivalent bump
- `chore:`, `docs:`, `refactor:`, `test:`, `ci:` → no version bump, but still show up in the
  changelog appropriately

Use a scope when it adds clarity (e.g. `fix(pipeline): ...`), but it's optional. PR titles should
also follow this format when the PR is squash-merged, since the squash commit message is what
release-please actually parses.

## Git workflow: never commit to main

Always create a feature branch and open a pull request — never commit directly to `main`, even
for a one-line fix or a docs-only change. There are no exceptions for small or "trivial" changes.
This applies to AI coding agents exactly as it does to human contributors.

## Release / publish gotchas

- `package.json`'s `version` field is managed by release-please via its release PRs — don't hand-edit it.
- Publishing uses npm's OIDC Trusted Publisher flow with sigstore provenance (see
  `.github/workflows/publish.yml`). Provenance verification checks `package.json`'s
  `repository.url` against the GitHub repo that produced the attestation — if that field is ever
  removed or changed, publish fails with `E422`. Keep it pointed at
  `git+https://github.com/bruuuuuuuce/goodmetrics-nodejs.git`.
- The committed `.npmrc` intentionally pins `registry=https://registry.npmjs.org/`. This exists
  because local/global npm configs on this team can point at an internal Artifactory/CodeArtifact
  registry — don't remove this file or add scoped registry overrides without checking that CI and
  local installs still resolve packages from the public registry.
- The `Build Node.js Package` workflow (on PRs) and `Release & Publish` workflow (on `main`) are
  separate; a green PR build does not guarantee the publish step will succeed (provenance/auth
  issues only surface at publish time).
