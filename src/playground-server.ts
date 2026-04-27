import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { createPlaygroundGist, fetchPlaygroundGist, GistError } from "./gists.js";
import { createRequestMetrics } from "./metrics.js";
import { playgroundConfig } from "./playground-config.js";
import { isPlaygroundAtCapacity, runActonSnippet } from "./playground-runner.js";
import { statsPageCss, statsPageHtml, statsPageJs } from "./stats-page.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(__dirname, "../../public/playground");

const runSchema = z.object({
  code: z.string().trim().min(1).max(playgroundConfig.maxCodeChars),
  stdin: z.string().max(playgroundConfig.maxStdinChars).optional(),
  args: z.array(z.string().max(200)).max(8).optional()
});

const gistSchema = z.object({
  code: z
    .string()
    .max(playgroundConfig.maxCodeChars)
    .refine((value) => value.trim().length > 0, "Code must not be empty.")
});

const gistParamsSchema = z.object({
  id: z.string().min(1).max(64)
});

const gistRouteOptions = {
  config: {
    rateLimit: {
      max: playgroundConfig.gistRateLimitMax,
      timeWindow: playgroundConfig.gistRateLimitWindow
    }
  }
};

const runRouteOptions = {
  config: {
    rateLimit: {
      max: playgroundConfig.rateLimitMax,
      timeWindow: playgroundConfig.rateLimitWindow
    }
  }
};

const app = Fastify({
  logger: {
    level: playgroundConfig.nodeEnv === "production" ? "info" : "debug"
  },
  trustProxy: true
});
const requestMetrics = createRequestMetrics({
  service: "Acton Playground"
});

requestMetrics.install(app);

await app.register(helmet, {
  contentSecurityPolicy: false
});

await app.register(cors, {
  origin: playgroundConfig.allowedOrigins,
  methods: ["GET", "POST", "OPTIONS"]
});

await app.register(rateLimit, {
  global: false,
  max: playgroundConfig.rateLimitMax,
  timeWindow: playgroundConfig.rateLimitWindow
});

app.get("/stats", async (_request, reply) =>
  reply
    .header("Cache-Control", "no-store")
    .type("text/html; charset=utf-8")
    .send(statsPageHtml("Acton Playground", "play"))
);

app.get("/stats.css", async (_request, reply) =>
  reply.header("Cache-Control", "no-store").type("text/css; charset=utf-8").send(statsPageCss)
);

app.get("/stats.js", async (_request, reply) =>
  reply.header("Cache-Control", "no-store").type("application/javascript; charset=utf-8").send(statsPageJs)
);

app.get("/api/stats", async (_request, reply) =>
  reply.header("Cache-Control", "no-store").send(requestMetrics.snapshot({ excludeCurrentRequest: true }))
);

await app.register(staticFiles, {
  root: publicRoot,
  prefix: "/"
});

app.get("/healthz", async () => ({
  ok: true,
  service: "acton-playground"
}));

app.post("/api/run", runRouteOptions, async (request, reply) => {
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

app.post("/api/run/stream", runRouteOptions, async (request, reply) => {
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

app.post("/api/gists", gistRouteOptions, async (request, reply) => {
  const requestId = request.id;
  const parsed = gistSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: "invalid_request",
      requestId,
      details: z.treeifyError(parsed.error)
    });
  }

  try {
    const gist = await createPlaygroundGist(parsed.data.code);
    return {
      id: gist.id,
      htmlUrl: gist.htmlUrl
    };
  } catch (error) {
    return handleGistError(error, request, reply, requestId);
  }
});

app.get("/api/gists/:id", gistRouteOptions, async (request, reply) => {
  const requestId = request.id;
  const parsed = gistParamsSchema.safeParse(request.params);

  if (!parsed.success) {
    return reply.code(400).send({
      error: "invalid_request",
      requestId,
      details: z.treeifyError(parsed.error)
    });
  }

  try {
    const gist = await fetchPlaygroundGist(parsed.data.id);

    if (gist.code.length > playgroundConfig.maxCodeChars) {
      return reply.code(413).send({
        error: "gist_too_large",
        requestId
      });
    }

    return gist;
  } catch (error) {
    return handleGistError(error, request, reply, requestId);
  }
});

app.setErrorHandler((error, request, reply) => {
  if (statusCodeOf(error) === 429) {
    return reply.code(429).send({
      error: "rate_limited",
      message: messageOf(error),
      requestId: request.id
    });
  }

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

function statusCodeOf(error: unknown): number | undefined {
  const maybeError = error as { statusCode?: unknown };
  return typeof maybeError.statusCode === "number" ? maybeError.statusCode : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Rate limit exceeded";
}

function handleGistError(error: unknown, request: FastifyRequest, reply: FastifyReply, requestId: string): unknown {
  if (error instanceof GistError) {
    if (error.statusCode >= 500) {
      request.log.error({ err: error, requestId }, "GitHub gist request failed");
    }

    return reply.code(error.statusCode).send({
      error: error.message,
      requestId
    });
  }

  request.log.error({ err: error, requestId }, "GitHub gist request failed");
  return reply.code(500).send({
    error: "gist_failed",
    requestId
  });
}
