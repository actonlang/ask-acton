import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import Fastify from "fastify";
import { z } from "zod";
import { playgroundConfig } from "./playground-config.js";
import { isPlaygroundAtCapacity, runActonSnippet } from "./playground-runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(__dirname, "../../public/playground");

const runSchema = z.object({
  code: z.string().trim().min(1).max(playgroundConfig.maxCodeChars),
  stdin: z.string().max(playgroundConfig.maxStdinChars).optional(),
  args: z.array(z.string().max(200)).max(8).optional()
});

const app = Fastify({
  logger: {
    level: playgroundConfig.nodeEnv === "production" ? "info" : "debug"
  },
  trustProxy: true
});

await app.register(helmet, {
  contentSecurityPolicy: false
});

await app.register(cors, {
  origin: playgroundConfig.allowedOrigins,
  methods: ["GET", "POST", "OPTIONS"]
});

await app.register(rateLimit, {
  max: playgroundConfig.rateLimitMax,
  timeWindow: playgroundConfig.rateLimitWindow
});

await app.register(staticFiles, {
  root: publicRoot,
  prefix: "/"
});

app.get("/healthz", async () => ({
  ok: true,
  service: "acton-playground"
}));

app.post("/api/run", async (request, reply) => {
  const requestId = request.id;
  const parsed = runSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: "invalid_request",
      requestId,
      details: z.treeifyError(parsed.error)
    });
  }

  try {
    return await runActonSnippet(parsed.data);
  } catch (error) {
    if (error instanceof Error && error.message === "playground_busy") {
      return reply.code(429).send({
        error: "playground_busy",
        requestId
      });
    }

    request.log.error({ err: error, requestId }, "Playground run failed");
    return reply.code(500).send({
      error: "playground_failed",
      requestId
    });
  }
});

app.post("/api/run/stream", async (request, reply) => {
  const requestId = request.id;
  const parsed = runSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: "invalid_request",
      requestId,
      details: z.treeifyError(parsed.error)
    });
  }

  if (isPlaygroundAtCapacity()) {
    return reply
      .code(429)
      .header("retry-after", "5")
      .send({
        error: "playground_busy",
        requestId
      });
  }

  const stream = new PassThrough();

  void runActonSnippet(parsed.data, (event) => {
    writeStreamEvent(stream, event);
  })
    .then((result) => {
      writeStreamEvent(stream, {
        type: "result",
        result
      });
    })
    .catch((error) => {
      if (error instanceof Error && error.message === "playground_busy") {
        writeStreamEvent(stream, {
          type: "error",
          error: "playground_busy",
          requestId
        });
        return;
      }

      request.log.error({ err: error, requestId }, "Playground stream failed");
      writeStreamEvent(stream, {
        type: "error",
        error: "playground_failed",
        requestId
      });
    })
    .finally(() => {
      stream.end();
    });

  return reply
    .type("application/x-ndjson; charset=utf-8")
    .header("cache-control", "no-cache")
    .send(stream);
});

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error, requestId: request.id }, "Unhandled request error");
  reply.code(500).send({
    error: "internal_error",
    requestId: request.id
  });
});

await app.listen({
  host: playgroundConfig.host,
  port: playgroundConfig.port
});

function writeStreamEvent(stream: PassThrough, event: unknown): void {
  stream.write(`${JSON.stringify(event)}\n`);
}
