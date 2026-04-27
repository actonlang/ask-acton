import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

type RequestKind = "api" | "asset" | "health" | "page";

type MutableBucket = {
  t: number;
  total: number;
  api: number;
  asset: number;
  health: number;
  page: number;
  ok: number;
  redirects: number;
  clientErrors: number;
  serverErrors: number;
  rateLimited: number;
  durationTotalMs: number;
  durationMaxMs: number;
};

export type MetricsSnapshot = {
  service: string;
  startedAt: string;
  generatedAt: string;
  uptimeSeconds: number;
  inFlight: number;
  bucketSeconds: number;
  retentionMinutes: number;
  totals: PublicBucket;
  lifetime: PublicBucket;
  buckets: PublicBucket[];
};

type PublicBucket = Omit<MutableBucket, "durationTotalMs"> & {
  avgDurationMs: number;
};

type RequestMetricsOptions = {
  service: string;
  retentionMinutes?: number;
};

type SnapshotOptions = {
  excludeCurrentRequest?: boolean;
};

const bucketMs = 60_000;

export function createRequestMetrics(options: RequestMetricsOptions) {
  const service = options.service;
  const retentionMinutes = options.retentionMinutes ?? 360;
  const retentionBuckets = Math.max(1, retentionMinutes);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const starts = new WeakMap<FastifyRequest, bigint>();
  const completed = new WeakSet<FastifyRequest>();
  const buckets = new Map<number, MutableBucket>();
  const lifetime = createBucket(0);
  let inFlight = 0;

  function install(app: FastifyInstance): void {
    app.addHook("onRequest", (request, _reply, done) => {
      starts.set(request, process.hrtime.bigint());
      inFlight += 1;
      done();
    });

    app.addHook("onResponse", (request, reply, done) => {
      completeRequest(request, reply);
      done();
    });
  }

  function completeRequest(request: FastifyRequest, replyOrStatus: FastifyReply | number): void {
    if (completed.has(request)) {
      return;
    }

    completed.add(request);

    if (inFlight > 0) {
      inFlight -= 1;
    }

    const start = starts.get(request);
    starts.delete(request);

    const durationMs = start === undefined ? 0 : Number(process.hrtime.bigint() - start) / 1_000_000;
    const statusCode = typeof replyOrStatus === "number" ? replyOrStatus : replyOrStatus.statusCode;
    const now = Date.now();
    const bucketStart = Math.floor(now / bucketMs) * bucketMs;
    const bucket = getBucket(bucketStart);
    const kind = requestKind(request.raw.url ?? "");

    record(bucket, kind, statusCode, durationMs);
    record(lifetime, kind, statusCode, durationMs);
    prune(now);
  }

  function snapshot(options: SnapshotOptions = {}): MetricsSnapshot {
    const now = Date.now();
    prune(now);

    const end = Math.floor(now / bucketMs) * bucketMs;
    const first = end - (retentionBuckets - 1) * bucketMs;
    const publicBuckets: PublicBucket[] = [];

    for (let t = first; t <= end; t += bucketMs) {
      publicBuckets.push(publicBucket(buckets.get(t) ?? createBucket(t)));
    }

    return {
      service,
      startedAt,
      generatedAt: new Date(now).toISOString(),
      uptimeSeconds: Math.round((now - startedAtMs) / 1000),
      inFlight: Math.max(0, inFlight - (options.excludeCurrentRequest ? 1 : 0)),
      bucketSeconds: bucketMs / 1000,
      retentionMinutes,
      totals: sumBuckets(publicBuckets),
      lifetime: publicBucket(lifetime),
      buckets: publicBuckets
    };
  }

  function getBucket(t: number): MutableBucket {
    const existing = buckets.get(t);
    if (existing !== undefined) {
      return existing;
    }

    const bucket = createBucket(t);
    buckets.set(t, bucket);
    return bucket;
  }

  function prune(now: number): void {
    const cutoff = now - retentionBuckets * bucketMs;

    for (const t of buckets.keys()) {
      if (t < cutoff) {
        buckets.delete(t);
      }
    }
  }

  return {
    install,
    completeRequest,
    snapshot
  };
}

function createBucket(t: number): MutableBucket {
  return {
    t,
    total: 0,
    api: 0,
    asset: 0,
    health: 0,
    page: 0,
    ok: 0,
    redirects: 0,
    clientErrors: 0,
    serverErrors: 0,
    rateLimited: 0,
    durationTotalMs: 0,
    durationMaxMs: 0
  };
}

function record(bucket: MutableBucket, kind: RequestKind, statusCode: number, durationMs: number): void {
  bucket.total += 1;
  bucket[kind] += 1;
  bucket.durationTotalMs += durationMs;
  bucket.durationMaxMs = Math.max(bucket.durationMaxMs, durationMs);

  if (statusCode === 429) {
    bucket.rateLimited += 1;
  }

  if (statusCode >= 500) {
    bucket.serverErrors += 1;
  } else if (statusCode >= 400) {
    bucket.clientErrors += 1;
  } else if (statusCode >= 300) {
    bucket.redirects += 1;
  } else {
    bucket.ok += 1;
  }
}

function publicBucket(bucket: MutableBucket): PublicBucket {
  const { durationTotalMs: _durationTotalMs, ...rest } = bucket;

  return {
    ...rest,
    avgDurationMs: bucket.total === 0 ? 0 : Math.round((bucket.durationTotalMs / bucket.total) * 10) / 10
  };
}

function sumBuckets(buckets: PublicBucket[]): PublicBucket {
  const sum = createBucket(0);

  for (const bucket of buckets) {
    sum.total += bucket.total;
    sum.api += bucket.api;
    sum.asset += bucket.asset;
    sum.health += bucket.health;
    sum.page += bucket.page;
    sum.ok += bucket.ok;
    sum.redirects += bucket.redirects;
    sum.clientErrors += bucket.clientErrors;
    sum.serverErrors += bucket.serverErrors;
    sum.rateLimited += bucket.rateLimited;
    sum.durationMaxMs = Math.max(sum.durationMaxMs, bucket.durationMaxMs);
    sum.durationTotalMs += bucket.avgDurationMs * bucket.total;
  }

  return publicBucket(sum);
}

function requestKind(rawUrl: string): RequestKind {
  const pathname = rawUrl.split("?", 1)[0] || "/";

  if (pathname === "/healthz") {
    return "health";
  }

  if (pathname.startsWith("/api/")) {
    return "api";
  }

  if (/\.[a-z0-9]{2,5}$/i.test(pathname)) {
    return "asset";
  }

  return "page";
}
