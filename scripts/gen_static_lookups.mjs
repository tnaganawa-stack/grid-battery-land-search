/**
 * 静的ルックアップJSONを生成するビルドスクリプト
 *
 * 生成物:
 *   src/data/cap_lookup.json          - 送電線空き容量フラットマップ
 *   src/data/demand_cap_lookup.json   - 需要想定容量フラットマップ
 *   src/data/distribution_6kv_grid.json - 6.6kV変電所グリッドインデックス
 *
 * 使い方: node scripts/gen_static_lookups.mjs
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "src", "data");

function normalizeName(n) {
  return n.replace(/[（(].*?[）)]/g, "").trim();
}

// ── 1. cap_lookup.json ─────────────────────────────────────────
{
  const raw = JSON.parse(fs.readFileSync(path.join(DATA, "grid_capacity_all.json"), "utf-8"));
  const exact = {};
  const normalized = {};
  for (const ds of raw) {
    for (const l of ds.lines) {
      if (!l.name) continue;
      exact[l.name] = l.availableMw;
      const norm = normalizeName(l.name);
      if (norm !== l.name) normalized[norm] = l.availableMw;
    }
  }
  const out = { exact, normalized };
  fs.writeFileSync(path.join(DATA, "cap_lookup.json"), JSON.stringify(out), "utf-8");
  console.log(`cap_lookup.json: exact=${Object.keys(exact).length}, normalized=${Object.keys(normalized).length}`);
}

// ── 2. demand_cap_lookup.json ──────────────────────────────────
{
  const raw = JSON.parse(fs.readFileSync(path.join(DATA, "grid_capacity_demand.json"), "utf-8"));
  const exact = {};
  const normalized = {};
  for (const ds of raw) {
    for (const l of ds.lines) {
      if (!l.name) continue;
      exact[l.name] = l.demandMw;
      const norm = normalizeName(l.name);
      if (norm !== l.name) normalized[norm] = l.demandMw;
    }
  }
  const out = { exact, normalized };
  fs.writeFileSync(path.join(DATA, "demand_cap_lookup.json"), JSON.stringify(out), "utf-8");
  console.log(`demand_cap_lookup.json: exact=${Object.keys(exact).length}`);
}

// ── 3. distribution_6kv_grid.json ─────────────────────────────
{
  const CELL = 0.1; // degrees (~11km)
  const geo = JSON.parse(fs.readFileSync(path.join(DATA, "distribution_6kv_geocoded.json"), "utf-8"));

  // 各変電所を格子セルに振り分け（最小限のフィールドのみ保持）
  const cells = {};
  for (const sub of geo) {
    const cellLat = (Math.floor(sub.lat / CELL) * CELL).toFixed(2);
    const cellLng = (Math.floor(sub.lng / CELL) * CELL).toFixed(2);
    const key = `${cellLat}_${cellLng}`;
    if (!cells[key]) cells[key] = [];
    cells[key].push({
      n: sub.name,
      la: parseFloat(sub.lat.toFixed(5)),
      lo: parseFloat(sub.lng.toFixed(5)),
      mw: sub.availableMw,
    });
  }
  const out = { cellSize: CELL, cells };
  fs.writeFileSync(path.join(DATA, "distribution_6kv_grid.json"), JSON.stringify(out), "utf-8");

  const cellCount = Object.keys(cells).length;
  const avgPerCell = (geo.length / cellCount).toFixed(1);
  const maxPerCell = Math.max(...Object.values(cells).map(c => c.length));
  console.log(`distribution_6kv_grid.json: ${cellCount}セル, 平均${avgPerCell}件/セル, 最大${maxPerCell}件/セル`);
}

console.log("完了");
