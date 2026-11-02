# File Ownership & Source of Truth

This document is the contract for what each generator may write.
Every generated file has exactly one authoritative writer and one
authoritative input set. When in doubt, this file wins over assumptions.

## Rules

1. Hand-written files are authoritative for their own content. No generator
   may modify them: `profile/01-hero.md` … `profile/07-console.md`,
   everything under `config/`, and `assets/logo/*`.
2. Generated files are reproducible from their documented inputs. Never edit
   them by hand — a later run will overwrite the edit.
3. Thumbnail files under `assets/thumbnail/` are manually supplied project
   assets. No generator writes, downloads, or deletes them.
4. A previously generated output is never an input. The shared placeholder
   never shadows a real thumbnail; fallbacks never overwrite richer content
   with poorer content when a better source is reachable.
5. Failures exit non-zero before any write. A failed run changes nothing.

## Ownership table

| Output | Sole writer | Authoritative inputs |
|---|---|---|
| `README.md` | `scripts/build-readme.mjs` | `profile/*.md` in `config/sequence.json` order |
| `profile/05-projects-generated.md` | `scripts/generate-project-cards.mjs` | GitHub repos API + `config/projects.json` + `assets/thumbnail/*` |
| `profile/06-starred-projects-generated.md` | `scripts/generate-starred-projects.mjs` | GitHub repos API + `config/projects.json` + `assets/thumbnail/*` |
| `profile/contributors-generated.md` | `scripts/generate-contributors.mjs` | GitHub contributors API over the eligible repositories of `config/profile.json` + `config/projects.json` |
| `assets/github/*.svg` | `scripts/generate-snake.mjs` | GitHub contributions API + `config/snake.json` |
| `assets/thumbnail/<repo>.<ext>` | committed by hand (manual project asset) | — (resolved read-only via `resolveLocalThumbnail`) |
| `assets/thumbnail/placeholder.svg` | tracked fallback asset, committed by hand | — (never auto-written) |

## Fallback policies

- **Thumbnails**: a file named after the repository under the profile
  repository's own `assets/thumbnail/` → otherwise the one shared static
  `placeholder.svg`, reused by every project without a thumbnail. Nothing is
  fetched, downloaded, generated, or modified.
- **Descriptions**: repo `description` → README first paragraph (API, then
  quota-free raw file) → deterministic language/topics fallback.
- **Repository selection**: exclude forks/archived/private and the profile
  repo itself; fall back to public, then to all, so a section is always
  produced when any repositories exist.

## Known limitations

- Card descriptions depend on live README fetches; an offline or
  rate-limited run falls back to generic text until a connected run refreshes it.- Thumbnail files are never auto-deleted; remove obsolete ones by hand when
  a project is retired. `pnpm ci` runs an explicit script allowlist, so a
  retired generator file sitting in `scripts/` can never execute implicitly.
- `pnpm ci` stops at the first failing generator by design; the snake step
  requires `GITHUB_TOKEN`, so a tokenless `pnpm ci` ends before starred/README.

## Contributors section

Regenerate with `pnpm contributors` (runs `scripts/generate-contributors.mjs`,
writing only `profile/contributors-generated.md`). `pnpm ci` runs it last,
after the card generators.

- **Data source**: the authenticated `GET /repos/{owner}/{repo}/contributors`
  endpoint over every repository of the profile account that survives the
  shared eligibility filter (`config/profile.json`: forks, archived, private
  and the profile repository itself excluded, id-deduplicated). No HTML is
  scraped and no commit history is walked. `GITHUB_TOKEN` is read from the
  environment only and is never written to a file, log or generated output.
- **Aggregation**: contributors are keyed by numeric GitHub id, falling back
  to the lowercased login when the API omits it. Each repository counts at
  most once per contributor, pagination never double counts, and `contributions`
  totals are summed only when every response carried a numeric count —
  otherwise the count is omitted from the table instead of guessed.
- **Bots**: excluded by default. Set `contributors.includeBots` to `true` in
  `config/projects.json` to include them (both `type: "Bot"` and `*[bot]`).
- **Ordering**: contribution count descending, then username alphabetically.
- **Truncation**: `contributors.maxContributors` (default `36`, `0` disables)
  caps the grid after sorting; a remainder line reports the rest.
- **Avatars**: remote URLs exactly as returned by GitHub, referenced over
  HTTPS only. They are never downloaded, copied or transformed, and the
  project thumbnail placeholder is never reused for them — a contributor
  without a usable avatar URL gets a styled initial tile instead.
- **Anonymous contributors are excluded** (`anon=false`) because they carry
  no GitHub identity to aggregate or link.
- **Failure policy**: a bad token (401) or a rate limit (403) fails the run
  before any write. A repository whose endpoint is unavailable (404/204/410
  or a timeout) is skipped with a sanitized warning, but if *every* eligible
  repository is unavailable the run fails instead of overwriting a good
  roster with an empty one.
