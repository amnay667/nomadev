import { createServer } from "node:http";
import type { Trade } from "./types.js";

export interface DashboardPosition {
  symbol: string;
  tokenAddress: string;
  pairAddress: string;
  entryPriceUsd: number;
  currentPriceUsd: number;
  quantity: number;
  costUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  openedAt: number;
}

export interface DashboardState {
  chainId: string;
  startingBalanceUsd: number;
  cashUsd: number;
  totalValueUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  modelSamples: number;
  positions: DashboardPosition[];
  trades: Trade[];
  lastUpdated: number;
}

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>meme-coin-bot</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #0b0d12;
    color: #e6e8ee;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding: 24px 32px 64px;
  }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  .sub { color: #7d8494; font-size: 13px; margin-bottom: 24px; }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    margin-bottom: 32px;
  }
  .card {
    background: #12151c;
    border: 1px solid #1f2430;
    border-radius: 10px;
    padding: 14px 16px;
  }
  .card .label { font-size: 12px; color: #7d8494; margin-bottom: 6px; }
  .card .value { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .pos { color: #4ade80; }
  .neg { color: #f87171; }
  .neutral { color: #e6e8ee; }
  section { margin-bottom: 32px; }
  h2 { font-size: 14px; color: #a8adba; text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #1f2430; white-space: nowrap; }
  th { color: #7d8494; font-weight: 500; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  th.num { text-align: right; }
  .empty { color: #7d8494; padding: 16px 0; font-size: 13px; }
  .side-BUY { color: #60a5fa; }
  .side-SELL { color: #f0abfc; }
  .updated { color: #4b5163; font-size: 12px; margin-top: 8px; }
  .charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
    gap: 16px;
  }
  .chart-card {
    background: #12151c;
    border: 1px solid #1f2430;
    border-radius: 10px;
    overflow: hidden;
  }
  .chart-card .chart-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 14px;
    font-size: 13px;
    font-weight: 600;
    border-bottom: 1px solid #1f2430;
  }
  .chart-card .chart-header a {
    color: #7d8494;
    font-size: 12px;
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
  }
  .chart-card .chart-header a:hover { color: #a8adba; }
  .chart-card iframe {
    display: block;
    width: 100%;
    height: 360px;
    border: none;
  }
</style>
</head>
<body>
  <h1>meme-coin-bot</h1>
  <div class="sub">Paper trading dashboard — refreshes every 5s</div>

  <div class="stats" id="stats"></div>

  <section>
    <h2>Open positions</h2>
    <div id="positions"></div>
  </section>

  <section>
    <h2>Charts</h2>
    <div id="charts" class="charts"></div>
  </section>

  <section>
    <h2>Trade history</h2>
    <div id="trades"></div>
  </section>

  <div class="updated" id="updated"></div>

<script>
function fmtUsd(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(n).toFixed(2);
}
function pnlClass(n) {
  return n > 0 ? "pos" : n < 0 ? "neg" : "neutral";
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString();
}
function esc(s) {
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

let renderedChartPairs = null;

async function refresh() {
  const res = await fetch("/api/state");
  const s = await res.json();

  document.getElementById("stats").innerHTML = [
    ["Total value", fmtUsd(s.totalValueUsd), pnlClass(s.totalValueUsd - s.startingBalanceUsd)],
    ["Cash", fmtUsd(s.cashUsd), "neutral"],
    ["Realized P&L", fmtUsd(s.realizedPnlUsd), pnlClass(s.realizedPnlUsd)],
    ["Unrealized P&L", fmtUsd(s.unrealizedPnlUsd), pnlClass(s.unrealizedPnlUsd)],
    ["Total P&L", fmtUsd(s.totalPnlUsd), pnlClass(s.totalPnlUsd)],
    ["Open positions", s.positions.length, "neutral"],
    ["Model samples", s.modelSamples, "neutral"],
  ].map(([label, value, cls]) =>
    \`<div class="card"><div class="label">\${label}</div><div class="value \${cls}">\${value}</div></div>\`
  ).join("");

  const positionsEl = document.getElementById("positions");
  if (s.positions.length === 0) {
    positionsEl.innerHTML = '<div class="empty">No open positions.</div>';
  } else {
    positionsEl.innerHTML = \`<table>
      <thead><tr>
        <th>Symbol</th><th class="num">Entry</th><th class="num">Current</th>
        <th class="num">Qty</th><th class="num">Cost</th>
        <th class="num">Unrealized P&L</th><th class="num">%</th><th>Opened</th>
      </tr></thead>
      <tbody>\${s.positions.map(p => \`
        <tr>
          <td>\${esc(p.symbol)}</td>
          <td class="num">$\${p.entryPriceUsd.toFixed(6)}</td>
          <td class="num">$\${p.currentPriceUsd.toFixed(6)}</td>
          <td class="num">\${p.quantity.toFixed(2)}</td>
          <td class="num">\${fmtUsd(p.costUsd)}</td>
          <td class="num \${pnlClass(p.unrealizedPnlUsd)}">\${fmtUsd(p.unrealizedPnlUsd)}</td>
          <td class="num \${pnlClass(p.unrealizedPnlPct)}">\${p.unrealizedPnlPct.toFixed(1)}%</td>
          <td>\${fmtTime(p.openedAt)}</td>
        </tr>\`).join("")}
      </tbody>
    </table>\`;
  }

  // Rebuild chart iframes only when the set of open positions actually
  // changes — reloading them every 5s refresh would flicker and reset
  // whatever timeframe/zoom the viewer picked on each chart.
  const chartPairsKey = s.positions.map(p => p.pairAddress).join(",");
  if (chartPairsKey !== renderedChartPairs) {
    renderedChartPairs = chartPairsKey;
    const chartsEl = document.getElementById("charts");
    if (s.positions.length === 0) {
      chartsEl.innerHTML = '<div class="empty">No open positions.</div>';
    } else {
      chartsEl.innerHTML = s.positions.map(p => {
        const dexUrl = p.pairAddress
          ? \`https://dexscreener.com/\${encodeURIComponent(s.chainId)}/\${encodeURIComponent(p.pairAddress)}\`
          : null;
        return \`
        <div class="chart-card">
          <div class="chart-header">
            <span>\${esc(p.symbol)}</span>
            \${dexUrl ? \`<a href="\${dexUrl}" target="_blank" rel="noopener noreferrer">Open on DexScreener ↗</a>\` : ""}
          </div>
          \${dexUrl
            ? \`<iframe src="\${dexUrl}?embed=1&theme=dark&trades=0&info=0" loading="lazy"></iframe>\`
            : '<div class="empty">Chart unavailable — this position was opened before chart tracking was added.</div>'}
        </div>\`;
      }).join("");
    }
  }

  const tradesEl = document.getElementById("trades");
  if (s.trades.length === 0) {
    tradesEl.innerHTML = '<div class="empty">No trades yet.</div>';
  } else {
    const rows = s.trades.slice().reverse();
    tradesEl.innerHTML = \`<table>
      <thead><tr>
        <th>Time</th><th>Side</th><th>Symbol</th><th class="num">Price</th>
        <th class="num">Qty</th><th class="num">Value</th><th class="num">Fee</th>
        <th class="num">P&L</th><th>Reason</th>
      </tr></thead>
      <tbody>\${rows.map(t => \`
        <tr>
          <td>\${fmtTime(t.timestamp)}</td>
          <td class="side-\${t.side}">\${t.side}</td>
          <td>\${esc(t.symbol)}</td>
          <td class="num">$\${t.priceUsd.toFixed(6)}</td>
          <td class="num">\${t.quantity.toFixed(2)}</td>
          <td class="num">\${fmtUsd(t.valueUsd)}</td>
          <td class="num">\${fmtUsd(t.feeUsd)}</td>
          <td class="num \${t.pnlUsd !== undefined ? pnlClass(t.pnlUsd) : ''}">\${t.pnlUsd !== undefined ? fmtUsd(t.pnlUsd) : '—'}</td>
          <td>\${t.reason}</td>
        </tr>\`).join("")}
      </tbody>
    </table>\`;
  }

  document.getElementById("updated").textContent =
    "Last updated " + new Date(s.lastUpdated).toLocaleTimeString();
}

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;

export function startDashboardServer(getState: () => DashboardState, port: number) {
  const server = createServer((req, res) => {
    if (req.url === "/api/state") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(getState()));
      return;
    }
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  server.listen(port, () => {
    console.log(`Dashboard: http://localhost:${port}`);
  });

  return server;
}
