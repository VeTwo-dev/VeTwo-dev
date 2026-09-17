import type { NormalizedRepo } from "../../profile/data/github.js";

function repo(overrides: Partial<NormalizedRepo> & { name: string }): NormalizedRepo {
  return {
    fullName: `VeTwo-dev/${overrides.name}`,
    description: null,
    url: `https://github.com/VeTwo-dev/${overrides.name}`,
    isFork: false,
    isArchived: false,
    language: "TypeScript",
    stars: 0,
    forks: 0,
    openIssues: 0,
    topics: [],
    createdAt: "2026-06-08T12:08:42Z",
    updatedAt: "2026-07-09T10:34:03Z",
    pushedAt: "2026-07-09T10:33:59Z",
    defaultBranch: "main",
    homepage: null,
    ...overrides,
  };
}

export const mockRepos: NormalizedRepo[] = [
  repo({
    name: "units",
    description: null,
    stars: 1,
    forks: 0,
    readmeLength: 14103,
    pushedAt: "2026-07-13T12:08:55Z",
  }),
  repo({
    name: "nutrition-units",
    description: null,
    stars: 1,
    readmeLength: 15978,
    pushedAt: "2026-07-12T10:09:47Z",
  }),
  repo({
    name: "Feed-Formulation",
    stars: 1,
    readmeLength: 4666,
    pushedAt: "2026-07-09T10:33:59Z",
  }),
  repo({
    name: "whichenv",
    readmeLength: 5155,
    pushedAt: "2026-07-23T23:29:52Z",
  }),
  repo({
    name: "Repo-Fetch",
    openIssues: 7,
    readmeLength: 39240,
    pushedAt: "2026-07-24T02:54:28Z",
  }),
  repo({
    name: "VeTwo-Market-Place",
    readmeLength: 11805,
    pushedAt: "2026-08-21T04:05:41Z",
  }),
  repo({
    name: "Cli-sound",
    readmeLength: 6446,
    pushedAt: "2026-07-26T02:00:27Z",
  }),
  repo({
    name: "Docs",
    readmeLength: 9498,
    pushedAt: "2026-09-17T10:38:40Z",
  }),
  // Edge cases — synthetic, for exercising selection/filter logic only.
  repo({ name: "an-old-fork", isFork: true, stars: 50 }),
  repo({ name: "archived-experiment", isArchived: true, stars: 20 }),
  repo({ name: "empty-scaffold", description: null, readmeLength: 20 }),
];
