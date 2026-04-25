import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8787),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().default("gpt-5.5"),
  OPENAI_VECTOR_STORE_ID: z.string().optional(),
  ALLOWED_ORIGINS: z.string().default("https://acton.guide,http://localhost:3000,http://127.0.0.1:3000"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(40),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  MAX_QUESTION_CHARS: z.coerce.number().int().positive().default(6000),
  MAX_CONTEXT_CHARS: z.coerce.number().int().positive().default(12000),
  MAX_HISTORY_MESSAGES: z.coerce.number().int().nonnegative().default(8)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration");
  console.error(z.treeifyError(parsed.error));
  process.exit(1);
}

const env = parsed.data;

export const config = {
  nodeEnv: env.NODE_ENV,
  host: env.HOST,
  port: env.PORT,
  openaiApiKey: env.OPENAI_API_KEY,
  openaiModel: env.OPENAI_MODEL,
  openaiVectorStoreId: env.OPENAI_VECTOR_STORE_ID,
  allowedOrigins: env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  rateLimitMax: env.RATE_LIMIT_MAX,
  rateLimitWindow: env.RATE_LIMIT_WINDOW,
  maxQuestionChars: env.MAX_QUESTION_CHARS,
  maxContextChars: env.MAX_CONTEXT_CHARS,
  maxHistoryMessages: env.MAX_HISTORY_MESSAGES
} as const;
