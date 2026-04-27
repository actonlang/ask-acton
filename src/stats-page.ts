const assetVersion = "20260427-stats";

export function statsPageHtml(service: string, active: "ask" | "play"): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(service)} Stats</title>
    <link rel="stylesheet" href="/stats.css?v=${assetVersion}">
    <script type="module" src="/stats.js?v=${assetVersion}"></script>
  </head>
  <body>
    <header class="app-header">
      <a class="app-mark" href="/stats">${escapeHtml(service)} Stats</a>
      <nav class="site-nav" aria-label="Acton sites">
        <a href="https://acton.guide/">Guide</a>
        <a${active === "play" ? ' class="is-active" aria-current="page"' : ""} href="https://play.acton.guide/">Play</a>
        <a${active === "ask" ? ' class="is-active" aria-current="page"' : ""} href="https://ask.acton.guide/">Ask</a>
      </nav>
    </header>

    <main>
      <section class="hero">
        <p class="eyebrow">Monitoring</p>
        <h1>${escapeHtml(service)} traffic</h1>
        <p>Aggregate request counts, status codes, and latency from the running service.</p>
      </section>

      <section class="cards" aria-label="Current service stats">
        <article class="card">
          <span>Requests</span>
          <strong id="total-requests">-</strong>
          <p id="window-label">Last window</p>
        </article>
        <article class="card">
          <span>API requests</span>
          <strong id="api-requests">-</strong>
          <p>Expensive routes only</p>
        </article>
        <article class="card">
          <span>Average latency</span>
          <strong id="avg-latency">-</strong>
          <p>Across retained requests</p>
        </article>
        <article class="card">
          <span>In flight</span>
          <strong id="in-flight">-</strong>
          <p>Requests active now</p>
        </article>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Requests</p>
            <h2>Per minute</h2>
          </div>
          <p id="updated-at">Loading...</p>
        </div>
        <div id="request-chart" class="chart" aria-label="Requests per minute"></div>
        <div class="legend" aria-label="Request chart legend">
          <span><i class="swatch ok"></i>2xx</span>
          <span><i class="swatch client"></i>4xx</span>
          <span><i class="swatch server"></i>5xx</span>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Latency</p>
            <h2>Average response time</h2>
          </div>
        </div>
        <div id="latency-chart" class="chart latency" aria-label="Average latency per minute"></div>
      </section>

      <section class="breakdown">
        <article class="panel compact">
          <p class="eyebrow">Status</p>
          <dl>
            <div><dt>2xx</dt><dd id="ok-count">-</dd></div>
            <div><dt>3xx</dt><dd id="redirect-count">-</dd></div>
            <div><dt>4xx</dt><dd id="client-error-count">-</dd></div>
            <div><dt>5xx</dt><dd id="server-error-count">-</dd></div>
            <div><dt>429</dt><dd id="rate-limited-count">-</dd></div>
          </dl>
        </article>
        <article class="panel compact">
          <p class="eyebrow">Routes</p>
          <dl>
            <div><dt>API</dt><dd id="api-count">-</dd></div>
            <div><dt>Pages</dt><dd id="page-count">-</dd></div>
            <div><dt>Assets</dt><dd id="asset-count">-</dd></div>
            <div><dt>Health</dt><dd id="health-count">-</dd></div>
          </dl>
        </article>
      </section>
    </main>
  </body>
</html>`;
}

export const statsPageCss = `
@font-face {
  font-family: "Open Sans";
  font-style: normal;
  font-weight: 800;
  src:
    local("Open Sans ExtraBold"),
    local("OpenSans-ExtraBold"),
    url("https://acton.guide/fonts/open-sans-v17-all-charsets-800.woff2") format("woff2");
}

:root {
  color-scheme: light dark;
  --bg: #eef0ef;
  --bg-soft: #f7f8f6;
  --panel: rgba(247, 248, 246, 0.92);
  --text: #191b1c;
  --muted: #5f666a;
  --border: rgba(35, 38, 40, 0.16);
  --accent: #ffd42a;
  --accent-soft: #fff3b4;
  --chrome-bg: #202326;
  --shadow: 0 18px 45px rgba(21, 22, 23, 0.12);
  font-family:
    "Avenir Next",
    "Neue Haas Grotesk Text",
    "Segoe UI",
    ui-sans-serif,
    system-ui,
    sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  min-height: 100vh;
  margin: 0;
  background:
    linear-gradient(120deg, rgba(255, 212, 42, 0.16), transparent 28rem),
    linear-gradient(180deg, var(--bg), var(--bg-soft) 48%, #ececeb);
  color: var(--text);
}

main {
  width: min(74rem, calc(100% - 2rem));
  margin: 0 auto;
  padding: 3.5rem 0;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 50px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  padding: 0 15px;
  background: var(--chrome-bg);
  color: #f7f8f6;
}

.app-mark {
  color: #f7f8f6;
  font-size: 1.5rem;
  font-weight: 850;
  letter-spacing: -0.03em;
  text-decoration: none;
}

.site-nav {
  display: inline-flex;
  align-self: stretch;
  align-items: stretch;
  gap: 2rem;
  font-family: "Open Sans", "Avenir Next", system-ui, sans-serif;
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.site-nav a {
  position: relative;
  display: inline-flex;
  align-items: center;
  color: #ffd42a;
  text-decoration: none;
}

.site-nav a:not(.is-active) {
  color: #f7f8f6;
}

.site-nav a.is-active::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 4px;
  border-radius: 999px 999px 0 0;
  background: #ffd42a;
  content: "";
}

.hero {
  max-width: 48rem;
  margin-bottom: 2rem;
}

.eyebrow {
  margin: 0 0 0.75rem;
  color: var(--muted);
  font-family: "Open Sans", "Avenir Next", system-ui, sans-serif;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

h1,
h2,
strong {
  font-family: "Open Sans", "Avenir Next", system-ui, sans-serif;
  letter-spacing: -0.04em;
}

h1 {
  margin: 0;
  font-size: clamp(3rem, 8vw, 6.5rem);
  line-height: 0.95;
}

h2 {
  margin: 0;
  font-size: clamp(1.8rem, 4vw, 3rem);
  line-height: 1;
}

p {
  color: var(--muted);
  font-size: 1.1rem;
  line-height: 1.55;
}

.cards,
.breakdown {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
  margin: 2rem 0;
}

.breakdown {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.card,
.panel {
  border: 1px solid var(--border);
  border-radius: 1.5rem;
  background: var(--panel);
  box-shadow: var(--shadow);
}

.card {
  padding: 1.3rem;
}

.card span {
  display: block;
  color: var(--muted);
  font-size: 0.9rem;
}

.card strong {
  display: block;
  margin-top: 0.45rem;
  font-size: clamp(2.2rem, 5vw, 4.2rem);
  line-height: 1;
}

.card p {
  margin: 0.75rem 0 0;
  font-size: 0.9rem;
}

.panel {
  margin: 1rem 0;
  padding: 1.3rem;
}

.panel-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.2rem;
}

.panel-header p {
  margin: 0;
}

.chart {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 14rem;
  border-radius: 1rem;
  padding: 1rem;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.1), transparent),
    rgba(32, 35, 38, 0.08);
}

.bar {
  flex: 1 1 2px;
  min-width: 2px;
  border-radius: 5px 5px 0 0;
  background: linear-gradient(180deg, var(--accent), rgba(255, 212, 42, 0.48));
}

.bar.has-errors {
  background: linear-gradient(180deg, #ff8b64, rgba(255, 139, 100, 0.55));
}

.bar.has-server-errors {
  background: linear-gradient(180deg, #d94b4b, rgba(217, 75, 75, 0.55));
}

.latency .bar {
  background: linear-gradient(180deg, #8fc5ff, rgba(143, 197, 255, 0.45));
}

.legend {
  display: flex;
  gap: 1.2rem;
  margin-top: 1rem;
  color: var(--muted);
  font-size: 0.9rem;
}

.swatch {
  display: inline-block;
  width: 0.8rem;
  height: 0.8rem;
  margin-right: 0.35rem;
  border-radius: 999px;
  vertical-align: -0.08em;
}

.swatch.ok {
  background: var(--accent);
}

.swatch.client {
  background: #ff8b64;
}

.swatch.server {
  background: #d94b4b;
}

.compact {
  margin: 0;
}

dl {
  margin: 0;
}

dl div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  border-top: 1px solid var(--border);
  padding: 0.8rem 0;
}

dl div:first-child {
  border-top: 0;
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
  font-weight: 800;
}

@media (max-width: 760px) {
  main {
    padding: 2rem 0;
  }

  .app-header {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.8rem;
    padding: 0.8rem 1rem 0;
  }

  .site-nav {
    min-height: 42px;
  }

  .cards,
  .breakdown {
    grid-template-columns: 1fr;
  }

  .panel-header {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #101112;
    --bg-soft: #17191b;
    --panel: rgba(31, 34, 37, 0.94);
    --text: #f4f5f2;
    --muted: #b7bdc2;
    --border: rgba(255, 255, 255, 0.18);
    --accent-soft: #3f3511;
    --shadow: 0 22px 55px rgba(0, 0, 0, 0.28);
  }

  body {
    background:
      linear-gradient(120deg, rgba(255, 212, 42, 0.12), transparent 28rem),
      linear-gradient(180deg, var(--bg), var(--bg-soft) 55%, #121415);
  }

  .chart {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent),
      rgba(0, 0, 0, 0.18);
  }
}
`.trim();

export const statsPageJs = `
const numberFormat = new Intl.NumberFormat();
const latencyFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit"
});

const elements = {
  totalRequests: document.querySelector("#total-requests"),
  apiRequests: document.querySelector("#api-requests"),
  avgLatency: document.querySelector("#avg-latency"),
  inFlight: document.querySelector("#in-flight"),
  windowLabel: document.querySelector("#window-label"),
  updatedAt: document.querySelector("#updated-at"),
  requestChart: document.querySelector("#request-chart"),
  latencyChart: document.querySelector("#latency-chart"),
  okCount: document.querySelector("#ok-count"),
  redirectCount: document.querySelector("#redirect-count"),
  clientErrorCount: document.querySelector("#client-error-count"),
  serverErrorCount: document.querySelector("#server-error-count"),
  rateLimitedCount: document.querySelector("#rate-limited-count"),
  apiCount: document.querySelector("#api-count"),
  pageCount: document.querySelector("#page-count"),
  assetCount: document.querySelector("#asset-count"),
  healthCount: document.querySelector("#health-count")
};

async function refresh() {
  const response = await fetch("/api/stats", {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("Stats request failed with " + response.status);
  }

  const stats = await response.json();
  render(stats);
}

function render(stats) {
  const totals = stats.totals;
  elements.totalRequests.textContent = numberFormat.format(totals.total);
  elements.apiRequests.textContent = numberFormat.format(totals.api);
  elements.avgLatency.textContent = latencyFormat.format(totals.avgDurationMs) + " ms";
  elements.inFlight.textContent = numberFormat.format(stats.inFlight);
  elements.windowLabel.textContent = "Last " + stats.retentionMinutes + " minutes";
  elements.updatedAt.textContent = "Updated " + timeFormat.format(new Date(stats.generatedAt));

  elements.okCount.textContent = numberFormat.format(totals.ok);
  elements.redirectCount.textContent = numberFormat.format(totals.redirects);
  elements.clientErrorCount.textContent = numberFormat.format(totals.clientErrors);
  elements.serverErrorCount.textContent = numberFormat.format(totals.serverErrors);
  elements.rateLimitedCount.textContent = numberFormat.format(totals.rateLimited);
  elements.apiCount.textContent = numberFormat.format(totals.api);
  elements.pageCount.textContent = numberFormat.format(totals.page);
  elements.assetCount.textContent = numberFormat.format(totals.asset);
  elements.healthCount.textContent = numberFormat.format(totals.health);

  renderRequestChart(elements.requestChart, compactBuckets(stats.buckets, 120));
  renderLatencyChart(elements.latencyChart, compactBuckets(stats.buckets, 120));
}

function compactBuckets(buckets, maxPoints) {
  if (buckets.length <= maxPoints) {
    return buckets;
  }

  const groupSize = Math.ceil(buckets.length / maxPoints);
  const groups = [];

  for (let i = 0; i < buckets.length; i += groupSize) {
    const group = buckets.slice(i, i + groupSize);
    const merged = group.reduce((sum, bucket) => {
      sum.t = bucket.t;
      sum.total += bucket.total;
      sum.ok += bucket.ok;
      sum.clientErrors += bucket.clientErrors;
      sum.serverErrors += bucket.serverErrors;
      sum.durationTotalMs += bucket.avgDurationMs * bucket.total;
      return sum;
    }, {
      t: group[0]?.t ?? 0,
      total: 0,
      ok: 0,
      clientErrors: 0,
      serverErrors: 0,
      durationTotalMs: 0
    });

    groups.push({
      ...merged,
      avgDurationMs: merged.total === 0 ? 0 : merged.durationTotalMs / merged.total
    });
  }

  return groups;
}

function renderRequestChart(container, buckets) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.total));
  renderBars(container, buckets, (bucket) => bucket.total, max, (bar, bucket) => {
    if (bucket.serverErrors > 0) {
      bar.classList.add("has-server-errors");
    } else if (bucket.clientErrors > 0) {
      bar.classList.add("has-errors");
    }
    bar.title = titleFor(bucket, bucket.total + " requests");
  });
}

function renderLatencyChart(container, buckets) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.avgDurationMs));
  renderBars(container, buckets, (bucket) => bucket.avgDurationMs, max, (bar, bucket) => {
    bar.title = titleFor(bucket, latencyFormat.format(bucket.avgDurationMs) + " ms average");
  });
}

function renderBars(container, buckets, valueOf, max, decorate) {
  container.replaceChildren();

  for (const bucket of buckets) {
    const bar = document.createElement("div");
    const value = valueOf(bucket);
    bar.className = "bar";
    bar.style.height = value === 0 ? "2px" : Math.max(4, (value / max) * 100) + "%";
    decorate(bar, bucket);
    container.append(bar);
  }
}

function titleFor(bucket, value) {
  return timeFormat.format(new Date(bucket.t)) + ": " + value;
}

refresh().catch((error) => {
  elements.updatedAt.textContent = "Stats unavailable";
  console.error(error);
});

setInterval(() => {
  refresh().catch((error) => {
    console.error(error);
  });
}, 15_000);
`.trim();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
