import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PLAYGROUND_HOST: z.string().default("0.0.0.0"),
  PLAYGROUND_PORT: z.coerce.number().int().positive().default(8788),
  PLAYGROUND_ALLOWED_ORIGINS: z
    .string()
    .default("https://play.acton.guide,https://acton.guide,https://www.acton-lang.org,https://acton-lang.org,https://acton.now,https://www.acton.now,http://localhost:3000,http://127.0.0.1:3000,http://localhost:8788,http://127.0.0.1:8788"),
  PLAYGROUND_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  PLAYGROUND_RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  PLAYGROUND_MAX_CODE_CHARS: z.coerce.number().int().positive().default(12000),
  PLAYGROUND_MAX_STDIN_CHARS: z.coerce.number().int().nonnegative().default(4000),
  PLAYGROUND_MAX_OUTPUT_CHARS: z.coerce.number().int().positive().default(20000),
  PLAYGROUND_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(90),
  PLAYGROUND_MAX_CONCURRENT_RUNS: z.coerce.number().int().positive().default(10),
  PLAYGROUND_WORKSPACE_ROOT: z.string().default("/var/lib/ask-acton/playground"),
  PLAYGROUND_CACHE_ROOT: z.string().default("/var/lib/ask-acton/cache"),
  PLAYGROUND_DOCKER_BIN: z.string().default("docker"),
  PLAYGROUND_DOCKER_NETWORK: z.string().default(""),
  PLAYGROUND_ACTON_IMAGE: z.string().default("ghcr.io/actonlang/acton:latest"),
  PLAYGROUND_CPU_LIMIT: z.string().default("2"),
  PLAYGROUND_MEMORY_LIMIT: z.string().default("3g"),
  PLAYGROUND_PIDS_LIMIT: z.coerce.number().int().positive().default(128),
  GITHUB_GIST_TOKEN: z.string().default(""),
  PLAYGROUND_GIST_FILENAME: z.string().default("main.act"),
  PLAYGROUND_GIST_DESCRIPTION: z.string().default("Acton playground snippet"),
  PLAYGROUND_GIST_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  PLAYGROUND_GIST_RATE_LIMIT_WINDOW: z.string().default("1 minute")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid playground environment configuration");
  console.error(z.treeifyError(parsed.error));
  process.exit(1);
}

const env = parsed.data;

export const playgroundConfig = {
  nodeEnv: env.NODE_ENV,
  host: env.PLAYGROUND_HOST,
  port: env.PLAYGROUND_PORT,
  allowedOrigins: env.PLAYGROUND_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  rateLimitMax: env.PLAYGROUND_RATE_LIMIT_MAX,
  rateLimitWindow: env.PLAYGROUND_RATE_LIMIT_WINDOW,
  maxCodeChars: env.PLAYGROUND_MAX_CODE_CHARS,
  maxStdinChars: env.PLAYGROUND_MAX_STDIN_CHARS,
  maxOutputChars: env.PLAYGROUND_MAX_OUTPUT_CHARS,
  timeoutSeconds: env.PLAYGROUND_TIMEOUT_SECONDS,
  maxConcurrentRuns: env.PLAYGROUND_MAX_CONCURRENT_RUNS,
  workspaceRoot: env.PLAYGROUND_WORKSPACE_ROOT,
  cacheRoot: env.PLAYGROUND_CACHE_ROOT,
  dockerBin: env.PLAYGROUND_DOCKER_BIN,
  dockerNetwork: env.PLAYGROUND_DOCKER_NETWORK.trim(),
  actonImage: env.PLAYGROUND_ACTON_IMAGE,
  cpuLimit: env.PLAYGROUND_CPU_LIMIT,
  memoryLimit: env.PLAYGROUND_MEMORY_LIMIT,
  pidsLimit: env.PLAYGROUND_PIDS_LIMIT,
  githubGistToken: env.GITHUB_GIST_TOKEN.trim(),
  gistFilename: env.PLAYGROUND_GIST_FILENAME.trim() || "main.act",
  gistDescription: env.PLAYGROUND_GIST_DESCRIPTION.trim() || "Acton playground snippet",
  gistRateLimitMax: env.PLAYGROUND_GIST_RATE_LIMIT_MAX,
  gistRateLimitWindow: env.PLAYGROUND_GIST_RATE_LIMIT_WINDOW
} as const;
