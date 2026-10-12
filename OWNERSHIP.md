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
3. Exactly one thumbnail file may exist per normalized repository name under
   `assets/thumbnail/`. Writers delete stale same-name siblings on write.
4. A previously generated output is never an input. Placeholders never shadow
   real thumbnails; fallbacks never overwrite richer content with poorer
   content when a better source is reachable.
5. Failures exit non-zero before any write. A failed run changes nothing.

## Ownership table

| Output | Sole writer | Authoritative inputs |
|---|---|---|
| `README.md` | `scripts/build-readme.mjs` | `profile/*.md` in `config/sequence.json` order |
| `profile/05-projects-generated.md` | `scripts/generate-project-cards.mjs` | GitHub repos API + `config/projects.json` + `assets/thumbnail/*` |
| `profile/06-starred-projects-generated.md` | `scripts/generate-starred-projects.mjs` | GitHub repos API + `config/projects.json` + `assets/thumbnail/*` |
| `assets/github/*.svg` | `scripts/generate-snake.mjs` | GitHub contributions API + `config/snake.json` |
| `assets/thumbnail/<repo>.<ext>` | `scripts/lib/thumbnails.mjs` helpers, called by the three project generators above | Source repo `assets/thumbnail/` via API, else repo metadata (generated placeholder) |
| `assets/thumbnail/placeholder.svg` | tracked fallback asset, committed by hand | — (never auto-written) |

## Fallback policies

- **Thumbnails**: local file → source repo `assets/thumbnail/` download →
  regenerated per-repo placeholder → generic `placeholder.svg` (last resort
  only, never written by automation).
- **Descriptions**: repo `description` → README first paragraph (API, then
  quota-free raw file) → deterministic language/topics fallback.
- **Repository selection**: exclude forks/archived/private and the profile
  repo itself; fall back to public, then to all, so a section is always
  produced when any repositories exist.

## Known limitations

- Card descriptions depend on live README fetches; an offline or
  rate-limited run falls back to generic text until a connected run refreshes it.
- Thumbnails for repositories that disappear upstream keep their last local
  file; orphaned files under `assets/thumbnail/` are never auto-deleted.
- `pnpm ci` stops at the first failing generator by design; the snake step
  requires `GITHUB_TOKEN`, so a tokenless `pnpm ci` ends before starred/README.
