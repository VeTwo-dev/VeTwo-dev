/**
 * MANUAL DATA
 * ───────────
 * Everything in this file is human-curated identity/config information that
 * cannot (and should not) be inferred from the GitHub API. Edit this file
 * directly to update who you are, your links, and which repositories are
 * pinned as "Featured". Nothing here is overwritten by the generator.
 *
 * GitHub-derived facts (stars, languages, activity, repo metadata) live in
 * `profile/data/github.ts` and are always fetched live — never hard-coded.
 */

export interface SocialLinks {
  readonly website?: string;
  readonly instagram?: string;
  readonly linkedin?: string;
}

export interface ProfileConfig {
  /** Display name shown in the hero section. */
  readonly name: string;
  /** One-line role/title shown under the name. */
  readonly roles: readonly string[];
  /** The GitHub login the generator collects data for. */
  readonly githubUsername: string;
  /** Only include links that are real and known — never placeholders. */
  readonly links: SocialLinks;
  /**
   * Explicit, human-picked repositories to feature, in priority order.
   * If a repo here no longer exists (renamed/deleted/private) the generator
   * skips it silently and fills the remaining slot from the fallback
   * ranking in `profile/generator/select.ts`.
   */
  readonly featuredRepositories: readonly string[];
  /** Total number of cards shown in the "Featured Projects" section. */
  readonly maxFeatured: number;
  /**
   * Manual grouping of repositories into ecosystem categories, used to
   * render the "VeTwo Ecosystem" section. Repos not listed here are placed
   * under a category inferred from their README (see select.ts), or
   * omitted entirely if they have no substantial README content — the
   * generator will not invent a category to force inclusion.
   */
  readonly ecosystemCategories: Readonly<Record<string, readonly string[]>>;
  /**
   * Repositories that are intentionally excluded from all auto-generated
   * sections (e.g. empty scaffolds, the profile repo itself). This is a
   * manual editorial decision, not a data-quality judgment made by code.
   */
  readonly excludeFromAuto: readonly string[];
}

export const profileConfig: ProfileConfig = {
  name: "Ahmed Kamal",
  roles: [
    "Veterinary Student",
    "Software Engineer",
    "Founder of VeTwo",
  ],
  githubUsername: "VeTwo-dev",
  links: {
    website: "https://vetwo.dev",
    instagram: "https://www.instagram.com/vetwo.dev/",
    // linkedin intentionally omitted — no confirmed handle. Add it here
    // once known; the generator will render it automatically.
  },
  featuredRepositories: [
    "units",
    "nutrition-units",
    "Feed-Formulation",
    "whichenv",
    "Repo-Fetch",
    "VeTwo-Market-Place",
  ],
  maxFeatured: 6,
  ecosystemCategories: {
    "Core Engine": ["units"],
    "Domain Layer": ["nutrition-units"],
    Applications: ["Feed-Formulation"],
    "Developer Tools": ["whichenv", "Repo-Fetch", "Cli-sound", "Create-VeTwo-Pack"],
    Infrastructure: ["VeTwo-Market-Place"],
    Documentation: ["Docs"],
  },
  excludeFromAuto: ["VeTwo-dev", "marketplace-fetch-pack", "Units-manager", "Cli"],
};
