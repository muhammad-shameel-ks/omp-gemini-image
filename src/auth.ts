import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AntigravityCredentials } from "./types.js";

const execFileAsync = promisify(execFile);

let cachedCreds: AntigravityCredentials | null = null;
let cacheExpiresAt = 0;

/**
 * Retrieves valid Google Antigravity OAuth credentials from Oh My Pi.
 * Automatically handles caching and refreshing through `omp token`.
 */
export async function getAntigravityCredentials(forceRefresh = false): Promise<AntigravityCredentials> {
  const now = Date.now();

  // Return cached token if valid for at least another minute
  if (!forceRefresh && cachedCreds && cacheExpiresAt > now + 60_000) {
    return cachedCreds;
  }

  // 1. Try resolving credentials directly from Oh My Pi
  try {
    const args = ["token", "google-antigravity", "--raw"];
    if (forceRefresh) {
      args.push("--force-refresh");
    }

    const { stdout } = await execFileAsync("omp", args, {
      timeout: 15_000,
      env: process.env,
    });

    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<AntigravityCredentials>;
      if (parsed.token) {
        const creds: AntigravityCredentials = {
          token: parsed.token,
          projectId: parsed.projectId || "aicode-consumers",
          refreshToken: parsed.refreshToken,
          expiresAt: parsed.expiresAt ? Number(parsed.expiresAt) : now + 50 * 60_000,
          email: parsed.email,
        };

        cachedCreds = creds;
        cacheExpiresAt = creds.expiresAt;
        return creds;
      }
    }
  } catch (error) {
    // If omp CLI execution failed, fallback to environment variable if present
    const envToken = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.ANTIGRAVITY_TOKEN;
    if (envToken && !forceRefresh) {
      return {
        token: envToken,
        projectId: "aicode-consumers",
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to retrieve Google Antigravity credentials from Oh My Pi: ${message}\n` +
      `Ensure you have logged into Antigravity via 'omp' (e.g. omp token google-antigravity).`
    );
  }

  // 2. Check environment variable fallback
  const envToken = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.ANTIGRAVITY_TOKEN;
  if (envToken) {
    return {
      token: envToken,
      projectId: "aicode-consumers",
    };
  }

  throw new Error(
    "No Google Antigravity credentials available. Please log in with Oh My Pi using 'omp token google-antigravity'."
  );
}
