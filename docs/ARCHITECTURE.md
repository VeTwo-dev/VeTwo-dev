# Profile generator — architecture

This repository's `README.md` is partly hand-written and partly generated
from live GitHub data. This document explains how, so future changes don't
have to be reverse-engineered from the code.

## Why this exists

A profile README that lists stars, languages, and "currently building"
claims by hand goes stale the day it's written. This generator keeps the
factual parts (stats, featured projects, language mix, recent activity)
synced to the real `VeTwo-dev` GitHub account automatically, while leaving
the personal parts (bio, ecosystem narrative, links) entirely under manual
control.

## Data flow

```
GitHub REST API
      │  (profile/data/github.ts)
      ▼
Raw repo/user JSON
      │  normalizeRepo()
      ▼
NormalizedRepo[] + GitHubUser
      │  validateRepos()            (profile/generator/validate.ts)
      ▼
Validated dataset
      │  selectFeatured() / categorizeEcosystem() / aggregateLanguages()
      ▼                              (profile/generator/select.ts)
Selected + grouped data
      │  renderStats() / renderFeatured() / renderEcosystem() /
      │  renderLanguages() / renderActivity()
      ▼                              (profile/generator/render.ts)
Markdown per section
      │  validateGeneratedMarkdown() (profile/generator/validate.ts)
      ▼
Validated markdown
      │  patchMarkers()              (profile/generator/patch.ts)
      ▼
README.md (only the AUTO regions change)
```

Nothing is written to disk until every step above succeeds. If any step
throws, `scripts/update-profile.ts` exits with a non-zero code and
`README.md` is left exactly as it was.

## MANUAL vs GitHub-derived vs GENERATED

| Kind | Where it lives | Who edits it |
|---|---|---|
| **Manual** | `profile/config/profile.ts`, and everything in `README.md` outside `<!-- AUTO:*:START/END -->` markers | You, directly |
| **GitHub-derived** | Fetched live from the GitHub REST API on every run | Nobody — it's a read-only mirror of your account |
| **Generated** | The text between `AUTO:*` marker pairs in `README.md` | The generator only — never hand-edit inside a marker, it will be overwritten on the next run |

## The marker system

Each auto-managed section of `README.md` is wrapped like this:

```md
<!-- AUTO:STATS:START -->
...generated content...
<!-- AUTO:STATS:END -->
```

`profile/generator/patch.ts` replaces only the text between a given pair.
It refuses to guess if a marker name appears more than once in the file
(`MarkerError`), and it reports (rather than silently ignores) any marker
the config expects but the README doesn't have. Everything outside marker
pairs — the hero banner, the "About" prose, the "Connect" links — is never
touched.

Current markers: `STATS`, `LANGUAGES`, `FEATURED`, `ECOSYSTEM`, `ACTIVITY`.

## Repository selection (`profile/generator/select.ts`)

`selectFeatured()`:
1. Walks `profileConfig.featuredRepositories` in order and keeps any that
   still exist on GitHub. A renamed/deleted/private repo is skipped
   silently — that's expected maintenance drift, not an error.
2. If there's remaining capacity (`maxFeatured`), it fills the rest from
   real repos not already selected, ranked by `scoreRepo()`: stars, forks,
   whether GitHub's `description` field is set, topic count, README length
   (fetched live), and mild recency. Forks and archived repos always score
   `-Infinity` and are never selected.

`categorizeEcosystem()` groups repos into the categories defined in
`profileConfig.ecosystemCategories`. A repo not mentioned in any category
falls into "Other" only if it has a real description or a README longer
than 200 characters — otherwise it's dropped rather than shown as an empty,
unhelpful row. `profileConfig.excludeFromAuto` lets you hide specific repos
(e.g. the profile repo itself, empty scaffolds) from every auto section.

## Local development

```bash
pnpm install

# Optional but recommended — avoids the 60 req/hour unauthenticated limit.
# A token with no scopes (public read only) is enough.
export GITHUB_TOKEN=ghp_xxx

pnpm run profile:update   # fetches live data and patches README.md
pnpm run profile:check    # same, but exits 1 instead of writing if it would change something
pnpm run typecheck
pnpm run lint
pnpm run test             # fully mocked — no network access, no token needed
```

## GitHub Actions (`.github/workflows/update-profile.yml`)

- Runs once a day (`03:00 UTC`), on manual dispatch, and when
  `profile/**` or `scripts/**` change on `main`.
- Uses the automatically-provided `secrets.GITHUB_TOKEN` — no manual
  secret setup required — giving 5,000 requests/hour, far more than this
  generator needs.
- Typechecks and runs the (fully mocked, network-free) test suite before
  touching `README.md`.
- Commits `README.md` only if `git diff` shows an actual change; otherwise
  the job is a no-op. This keeps the commit history meaningful instead of
  one empty commit per day.
- `permissions: contents: write` is the only permission granted.

## Customizing

- **Change identity, links, or which repos are featured:** edit
  `profile/config/profile.ts` only. Nothing else needs to change.
- **Add/remove an ecosystem category:** edit
  `profileConfig.ecosystemCategories`. A category with no matching repos
  is simply omitted from the rendered section — you won't get an empty
  heading.
- **Change how a section looks:** edit the corresponding `render*()`
  function in `profile/generator/render.ts`. Keep changes text-only —
  GitHub strips `<script>`/`<style>` from README rendering, so there is
  no CSS or JS to reach for here.
- **Add a new AUTO section:** add a `<!-- AUTO:NAME:START/END -->` pair to
  `README.md`, a `renderX()` function, and one more line in the `sections`
  object in `scripts/update-profile.ts`.

## Troubleshooting

- **`GitHub API ... failed: 403 ... rate limit exceeded`** — you're
  running unauthenticated and hit the 60/hour cap. Set `GITHUB_TOKEN`
  locally, or just wait — GitHub Actions always runs authenticated and is
  unaffected.
- **`README is missing required marker(s): ...`** — someone edited
  `README.md` and removed or renamed a marker comment. Restore the
  `<!-- AUTO:NAME:START -->` / `<!-- AUTO:NAME:END -->` pair; the generator
  refuses to write until it's sure which region to patch.
- **`Marker AUTO:X appears N times`** — a marker pair got duplicated
  (e.g. via a bad merge). Remove the duplicate manually; the generator
  will not guess which copy is the "real" one.
