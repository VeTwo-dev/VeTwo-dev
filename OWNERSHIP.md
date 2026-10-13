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
  rate-limited run falls back to generic text until a connected run refreshes it.
- Thumbnail files are never auto-deleted; remove obsolete ones by hand when
  a project is retired. `pnpm ci` runs an explicit script allowlist, so a
  retired generator file sitting in `scripts/` can never execute implicitly.
- `pnpm ci` stops at the first failing generator by design; the snake step
  requires `GITHUB_TOKEN`, so a tokenless `pnpm ci` ends before starred/README.
