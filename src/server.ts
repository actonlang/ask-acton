import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { answerQuestion } from "./openai.js";

const askSchema = z.object({
  question: z.string().trim().min(1).max(config.maxQuestionChars),
  code: z.string().max(config.maxContextChars).optional(),
  error: z.string().max(config.maxContextChars).optional(),
  page: z
    .object({
      url: z.string().url().optional(),
      title: z.string().max(300).optional(),
      excerpt: z.string().max(config.maxContextChars).optional()
    })
    .optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(config.maxContextChars)
      })
    )
    .max(config.maxHistoryMessages)
    .optional()
});

const app = Fastify({
  logger: {
    level: config.nodeEnv === "production" ? "info" : "debug"
  },
  trustProxy: true
});

await app.register(helmet, {
  global: true
});

await app.register(cors, {
  origin: config.allowedOrigins,
  methods: ["GET", "POST", "OPTIONS"]
});

await app.register(rateLimit, {
  max: config.rateLimitMax,
  timeWindow: config.rateLimitWindow
});

app.get("/healthz", async () => ({
  ok: true,
  service: "ask-acton"
}));

app.post("/api/ask", async (request, reply) => {
  const requestId = request.id;
  const parsed = askSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: "invalid_request",
      requestId,
      details: z.treeifyError(parsed.error)
    });
  }

  try {
    return await answerQuestion(parsed.data, requestId);
  } catch (error) {
    request.log.error({ err: error, requestId }, "OpenAI request failed");
    return reply.code(502).send({
      error: "ask_acton_failed",
      requestId
    });
  }
});

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error, requestId: request.id }, "Unhandled request error");
  reply.code(500).send({
    error: "internal_error",
    requestId: request.id
  });
});

await app.listen({
  host: config.host,
  port: config.port
});
