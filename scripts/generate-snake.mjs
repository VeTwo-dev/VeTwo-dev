import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { generateSnakeAnimation } from "generate-snake-animation";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "assets", "github");

const lightOutput = path.join(outputDir, "github-contribution-grid-snake.svg");
const darkOutput = path.join(outputDir, "github-contribution-grid-snake-dark.svg");

// Palette definitions mirroring generate-snake-animation cli palettes
// Needed at runtime because the library's DrawOptions expects full color objects,
// while the spec requires keeping `palette: "github"` literals in the outputs.
const palettes = {
  github: {
    colorDots: {
      0: "#ebedf0",
      1: "#9be9a8",
      2: "#40c463",
      3: "#30a14e",
      4: "#216e39",
    },
    colorEmpty: "#ebedf0",
    colorDotBorder: "#1b1f230a",
    colorSnake: "#8957e5",
  },
  "github-dark": {
    colorDots: {
      0: "#161b22",
      1: "#01311f",
      2: "#034525",
      3: "#0f6d31",
      4: "#00c647",
    },
    colorEmpty: "#161b22",
    colorDotBorder: "#1b1f230a",
    colorSnake: "#8957e5",
  },
};

function resolveDrawOptions(drawOptions) {
  const palette = palettes[drawOptions.palette] ?? {};
  return {
    sizeCell: 16,
    sizeDot: 12,
    sizeDotBorderRadius: 2,
    ...palette,
    ...drawOptions,
    // Ensure both naming conventions are satisfied:
    // spec requires color_snake, library requires colorSnake
    colorSnake: drawOptions.color_snake ?? drawOptions.colorSnake ?? palette.colorSnake ?? "#8957e5",
    color_snake: drawOptions.color_snake ?? drawOptions.colorSnake ?? "#8957e5",
    // Ensure palette stays present for spec compliance
    palette: drawOptions.palette,
  };
}

function sanitize(str, token) {
  if (!str || !token) return str;
  // Avoid exposing token in error output
  if (typeof str !== "string") str = String(str);
  return str.split(token).join("[REDACTED]");
}

function getTrackedFiles() {
  try {
    const out = execSync("git ls-files", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isExcluded(file) {
  // Do NOT scan .git/, node_modules/, assets/github/*.svg
  if (file.startsWith(".git/") || file === ".git") return true;
  if (file.startsWith("node_modules/") || file === "node_modules") return true;
  if (file.startsWith("assets/github/")) return true;
  return false;
}

function isPlaceholderTokenValue(match) {
  const lower = match.toLowerCase();
  // Common placeholders that should NOT be treated as credentials
  const placeholders = ["your_token", "yourtoken", "<token>", "example", "placeholder"];
  for (const p of placeholders) {
    if (lower.includes(p)) return true;
  }
  // If match is exactly short placeholder, ignore
  // Also ignore if suffix after prefix is placeholder-like
  return false;
}

async function checkTokenExposure(token) {
  const trackedFiles = getTrackedFiles();
  const trackedSet = new Set(trackedFiles);

  // Files to inspect for local env check (even if untracked)
  const envFiles = [".env", ".env.local", ".env.development", ".env.production"];

  let exactMatches = [];
  let credentialMatches = [];
  let localEnvWithToken = [];

  // --- 1. Check exact token in tracked files ---
  for (const file of trackedFiles) {
    if (isExcluded(file)) continue;
    const fullPath = path.join(root, file);
    try {
      const st = await stat(fullPath);
      if (!st.isFile()) continue;
      // Skip large files > 5MB to keep lightweight
      if (st.size > 5 * 1024 * 1024) continue;
      const content = await readFile(fullPath, "utf8");
      if (content.includes(token)) {
        exactMatches.push(file);
      }
    } catch {
      // Ignore binary or unreadable files
    }
  }

  if (exactMatches.length > 0) {
    return {
      exposed: true,
      type: "exact",
      files: [...new Set(exactMatches)],
      trackedFiles,
      localEnvWithToken,
    };
  }

  // --- 2. Check credential-like patterns in tracked files ---
  // Require at least 20 characters after prefix to avoid false positives like "ghp_" alone
  const credentialRegex = /(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/g;

  for (const file of trackedFiles) {
    if (isExcluded(file)) continue;
    const fullPath = path.join(root, file);
    try {
      const st = await stat(fullPath);
      if (!st.isFile()) continue;
      if (st.size > 5 * 1024 * 1024) continue;
      const content = await readFile(fullPath, "utf8");
      // Quick skip if no prefix at all
      if (!content.includes("ghp_") && !content.includes("gho_") && !content.includes("ghu_") && !content.includes("ghs_") && !content.includes("ghr_") && !content.includes("github_pat_")) {
        continue;
      }
      const matches = content.match(credentialRegex);
      if (matches) {
        // Filter placeholders
        const realMatches = matches.filter((m) => !isPlaceholderTokenValue(m));
        if (realMatches.length > 0) {
          credentialMatches.push(file);
        }
      }
    } catch {
      // ignore
    }
  }

  if (credentialMatches.length > 0) {
    return {
      exposed: true,
      type: "pattern",
      files: [...new Set(credentialMatches)],
      trackedFiles,
      localEnvWithToken,
    };
  }

  // --- 3. Check env files for local-only token presence ---
  for (const envFile of envFiles) {
    const fullPath = path.join(root, envFile);
    if (!existsSync(fullPath)) continue;
    try {
      const content = await readFile(fullPath, "utf8");
      if (content.includes(token)) {
        if (!trackedSet.has(envFile)) {
          localEnvWithToken.push(envFile);
        } else {
          // If env file is tracked and contains token, it would have been caught as exact match above
          // But just in case, treat as exposed
          return {
            exposed: true,
            type: "exact",
            files: [envFile],
            trackedFiles,
            localEnvWithToken: [],
          };
        }
      }
    } catch {
      // ignore
    }
  }

  // Also check the explicit common files list for local presence? We'll rely on tracked scan above
  // For env local warning, we already collected

  return {
    exposed: false,
    files: [],
    trackedFiles,
    localEnvWithToken,
  };
}

async function main() {
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      console.error("GITHUB_TOKEN is required to generate the GitHub contribution snake.");
      process.exit(1);
    }

    // --- Security check before generation ---
    const result = await checkTokenExposure(token);

    if (result.exposed) {
      if (result.type === "exact") {
        console.error("⚠️ GitHub token exposure detected.");
        console.error("");
        console.error("The GITHUB_TOKEN value appears to be present in:");
        for (const f of result.files) {
          console.error(`- ${f}`);
        }
        console.error("");
        console.error("The Snake generation was stopped for security.");
        console.error("Remove the token from the repository and rotate/revoke it if necessary.");
        console.error("");
        console.error("🚨 GitHub token exposure detected.");
        console.error("❌ Snake generation stopped for security.");
      } else if (result.type === "pattern") {
        console.error("⚠️ Possible GitHub token exposure detected.");
        console.error("");
        console.error("A GitHub credential-like value was found in:");
        for (const f of result.files) {
          console.error(`- ${f}`);
        }
        console.error("");
        console.error("The Snake generation was stopped for security.");
        console.error("");
        console.error("🚨 GitHub token exposure detected.");
        console.error("❌ Snake generation stopped for security.");
      }
      process.exit(1);
    }

    // Token safe - report status
    console.log("🔐 GitHub token check passed.");
    if (result.localEnvWithToken && result.localEnvWithToken.length > 0) {
      // Local-only warning
      console.error("⚠️ GITHUB_TOKEN is present in a local environment file:");
      console.error("");
      for (const f of result.localEnvWithToken) {
        console.error(`- ${f}`);
      }
      console.error("");
      console.error("This file is not Git-tracked, so it is not currently exposed through Git.");
      console.log("ℹ️ GITHUB_TOKEN is loaded from the environment.");
    } else {
      // Check if token is generally loaded from env (always true if we reach here)
      // For safe state we just show passed, but spec also says local warning variant includes this line
      // We'll show generic info for safe as well? Spec says safe = "🔐 ... 🐍 Generating..."
      // But we keep safe minimal to match spec
    }
    console.log("🐍 Generating contribution snake...");

    await mkdir(outputDir, { recursive: true });

    const outputs = [
      {
        format: "svg",
        drawOptions: {
          palette: "github",
          color_snake: "#8957e5",
        },
      },
      {
        format: "svg",
        drawOptions: {
          palette: "github-dark",
          color_snake: "#8957e5",
        },
      },
    ];

    // Resolve palette shorthands to full DrawOptions for runtime compatibility
    const resolvedOutputs = outputs.map((o) => ({
      format: o.format,
      drawOptions: resolveDrawOptions(o.drawOptions),
      animationOptions: o.animationOptions ?? { stepDurationMs: 100, frameByStep: 1 },
    }));

    const results = await generateSnakeAnimation(
      {
        platform: "github",
        username: "VeTwo-dev",
        githubToken: token,
      },
      resolvedOutputs,
    );

    if (!results || results.length !== 2 || !results[0] || !results[1]) {
      console.error("Unexpected result from generateSnakeAnimation: expected 2 outputs.");
      process.exit(1);
    }

    await writeFile(lightOutput, results[0]);
    await writeFile(darkOutput, results[1]);

    console.log("Generated GitHub contribution snake:");
    console.log(` - ${path.relative(root, lightOutput)}`);
    console.log(` - ${path.relative(root, darkOutput)}`);
  } catch (error) {
    // Sanitize token from error before printing
    const token = process.env.GITHUB_TOKEN || "";
    const msg = error instanceof Error ? error.message : String(error);
    const sanitized = token ? sanitize(msg, token) : msg;
    // Also sanitize stack if present
    let stack = "";
    if (error instanceof Error && error.stack) {
      stack = token ? sanitize(error.stack, token) : error.stack;
      // Only print stack sanitized, but avoid leaking token in stack
      // We will not print full stack to keep output concise and safe
    }
    console.error("Failed to generate GitHub contribution snake:", sanitized);
    // Avoid printing stack that might contain token details; keep lightweight
    process.exit(1);
  }
}

await main();
