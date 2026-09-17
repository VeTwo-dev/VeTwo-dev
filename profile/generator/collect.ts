import {
  fetchLanguages,
  fetchReadmeLength,
  fetchRepos,
  fetchUser,
  normalizeRepo,
  type GitHubUser,
  type NormalizedRepo,
} from "../data/github.js";
import { profileConfig } from "../config/profile.js";
import { validateRepos } from "./validate.js";

export interface ProfileDataset {
  readonly user: GitHubUser;
  readonly repos: NormalizedRepo[];
}

export interface CollectOptions {
  readonly token?: string;
  /** Repos to enrich with per-repo language bytes + README length (expensive calls). */
  readonly enrich?: readonly string[];
}

/**
 * Fetches and normalizes everything the generator needs. Enrichment
 * (language bytes, README length) is limited to a small explicit set of
 * repos — featured + ecosystem candidates — to keep API usage bounded and
 * predictable rather than hitting every endpoint for all 100+ possible
 * repos an account could have.
 */
export async function collectProfileData(options: CollectOptions = {}): Promise<ProfileDataset> {
  const { token } = options;
  const username = profileConfig.githubUsername;

  const [user, rawRepos] = await Promise.all([fetchUser(username, token), fetchRepos(username, token)]);

  let repos = rawRepos.map(normalizeRepo);
  validateRepos(repos);

  const enrichTargets = new Set(
    options.enrich ?? [
      ...profileConfig.featuredRepositories,
      ...Object.values(profileConfig.ecosystemCategories).flat(),
    ],
  );

  repos = await Promise.all(
    repos.map(async (repo) => {
      if (!enrichTargets.has(repo.name)) return repo;
      const [languageBytes, readmeLength] = await Promise.all([
        fetchLanguages(username, repo.name, token).catch(() => undefined),
        fetchReadmeLength(username, repo.name, token).catch(() => null),
      ]);
      return { ...repo, languageBytes, readmeLength };
    }),
  );

  return { user, repos };
}
