/**
 * 東北7県の送電線静的JSON生成スクリプト
 * Overpass APIから各県の66kV以上の送電線を取得して静的JSONに保存する
 *
 * 使い方: node scripts/gen_transmission_tohoku.mjs
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "src", "data");

// 東北各県のバウンディングボックス [south, west, north, east]
const PREFECTURES = [
  { name: "tohoku_aomori",  label: "青森",   bbox: [40.2, 139.7, 41.6, 141.7] },
  { name: "tohoku_iwate",   label: "岩手",   bbox: [38.8, 140.6, 40.5, 141.7] },
  { name: "tohoku_miyagi",  label: "宮城",   bbox: [37.7, 140.1, 39.0, 141.7] },
  { name: "tohoku_akita",   label: "秋田",   bbox: [38.8, 139.4, 40.5, 141.0] },
  { name: "tohoku_yamagata",label: "山形",   bbox: [37.7, 139.4, 39.0, 140.6] },
  { name: "tohoku_fukushima",label: "福島",  bbox: [36.8, 139.4, 37.9, 141.2] },
  { name: "tohoku_niigata", label: "新潟",   bbox: [36.7, 137.6, 38.6, 139.8] },
];

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DELAY_MS = 4000;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function buildQuery(bbox) {
  const [s, w, n, e] = bbox;
  return `[out:json][timeout:90];
(
  way["power"="line"]["voltage"~"^(66000|77000|154000|275000|500000)$"](${s},${w},${n},${e});
  way["power"="cable"]["voltage"~"^(66000|77000|154000|275000|500000)$"](${s},${w},${n},${e});
);
out body geom;`;
}

function parseVoltage(voltageStr) {
  if (!voltageStr) return null;
  const v = parseInt(voltageStr, 10);
  if (isNaN(v)) return null;
  if (v >= 500000) return 500;
  if (v >= 275000) return 275;
  if (v >= 154000) return 154;
  if (v >= 77000) return 77;
  if (v >= 66000) return 66;
  return null;
}

function resolveLocation(tags) {
  if (!tags) return "overhead";
  if (tags.power === "cable") return "underground";
  if (tags.location === "underground") return "underground";
  if (tags.location === "underwater") return "underground";
  return "overhead";
}

async function fetchPrefecture(pref) {
  const { name, label, bbox } = pref;
  const query = buildQuery(bbox);
  console.log(`[${label}] Overpass APIに問い合わせ中...`);

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "grid-battery-land-search/1.0",
      "Accept": "application/json",
    },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${label}`);
  }

  const json = await res.json();
  const ways = json.elements ?? [];
  console.log(`[${label}] ${ways.length} ways取得`);

  const lines = [];
  for (const way of ways) {
    if (!way.geometry || way.geometry.length < 2) continue;
    const voltageKv = parseVoltage(way.tags?.voltage);
    if (!voltageKv) continue;

    const rawName = way.tags?.name ?? way.tags?.["name:ja"] ?? "";
    const id = `osm-${voltageKv}kv-${way.id}`;
    const location = resolveLocation(way.tags);

    lines.push({
      id,
      name: rawName,
      voltageKv,
      path: way.geometry.map(pt => ({ lat: pt.lat, lng: pt.lon })),
      location,
    });
  }

  const by66  = lines.filter(l => l.voltageKv === 66).length;
  const by154 = lines.filter(l => l.voltageKv === 154).length;
  const by275 = lines.filter(l => l.voltageKv === 275).length;
  const ug    = lines.filter(l => l.location === "underground").length;
  console.log(`[${label}] ${lines.length} 件 (66kV:${by66}, 154kV:${by154}, 275kV:${by275}, 地中:${ug})`);
  return lines;
}

async function main() {
  console.log("=== 東北送電線データ取得開始 ===\n");

  for (const pref of PREFECTURES) {
    const outPath = path.join(OUT_DIR, `transmission_lines_${pref.name}.json`);

    if (fs.existsSync(outPath)) {
      const existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
      console.log(`[${pref.label}] 既存ファイル使用 (${existing.length} 件) → スキップ`);
      continue;
    }

    try {
      const lines = await fetchPrefecture(pref);
      fs.writeFileSync(outPath, JSON.stringify(lines, null, 2), "utf-8");
      console.log(`[${pref.label}] 保存完了: ${outPath}\n`);
    } catch (err) {
      console.error(`[${pref.label}] エラー: ${err.message}`);
    }

    console.log(`${DELAY_MS / 1000}秒待機中...`);
    await sleep(DELAY_MS);
  }

  console.log("\n=== 完了 ===");
}

main().catch(console.error);
