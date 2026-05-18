/**
 * 関西電力エリア（7府県）の送電線静的JSON生成スクリプト
 * Overpass APIから各府県の66kV以上の送電線を取得して静的JSONに保存する
 *
 * 使い方: node scripts/gen_transmission_kansai.mjs
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "src", "data");

// 関西電力エリア各府県のバウンディングボックス [south, west, north, east]
const PREFECTURES = [
  { name: "kansai_fukui",      label: "福井",   bbox: [35.4, 135.7, 36.3, 136.7] },
  { name: "kansai_shiga",      label: "滋賀",   bbox: [34.7, 135.7, 35.7, 136.4] },
  { name: "kansai_kyoto",      label: "京都",   bbox: [34.7, 134.8, 35.8, 136.0] },
  { name: "kansai_osaka",      label: "大阪",   bbox: [34.2, 135.0, 35.0, 135.8] },
  { name: "kansai_hyogo",      label: "兵庫",   bbox: [33.8, 134.1, 35.7, 135.5] },
  { name: "kansai_nara",       label: "奈良",   bbox: [33.8, 135.5, 34.8, 136.3] },
  { name: "kansai_wakayama",   label: "和歌山", bbox: [33.4, 135.0, 34.3, 136.3] },
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
  if (v >= 77000)  return 77;
  if (v >= 66000)  return 66;
  return null;
}

function resolveLocation(tags) {
  if (!tags) return "overhead";
  if (tags.power === "cable") return "underground";
  if (tags.location === "underground" || tags.location === "underwater") return "underground";
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

  const data = await res.json();
  const ways = data.elements || [];
  console.log(`  → ${ways.length} フィーチャ取得`);

  const results = [];
  for (const way of ways) {
    if (!way.geometry || way.geometry.length < 2) continue;
    const tags = way.tags || {};
    const voltKv = parseVoltage(tags.voltage);
    if (!voltKv) continue;

    const lineName = tags.name || tags["name:ja"] || "";
    const pathArr  = way.geometry.map(pt => ({ lat: pt.lat, lng: pt.lon }));

    results.push({
      id:        `kansai-${way.id}`,
      name:      lineName,
      voltageKv: voltKv,
      path:      pathArr,
      location:  resolveLocation(tags),
    });
  }

  console.log(`  → 変換後 ${results.length} 件`);

  const outPath = path.join(OUT_DIR, `transmission_lines_${name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`  → 出力: ${outPath}`);
  return results.length;
}

async function main() {
  console.log("=== 関西エリア送電線データ取得開始 ===\n");
  let total = 0;
  for (const pref of PREFECTURES) {
    try {
      total += await fetchPrefecture(pref);
    } catch (e) {
      console.error(`  [エラー] ${pref.label}: ${e.message}`);
    }
    if (pref !== PREFECTURES[PREFECTURES.length - 1]) {
      console.log(`  Overpassレート制限回避のため ${DELAY_MS / 1000}秒待機...\n`);
      await sleep(DELAY_MS);
    }
  }
  console.log(`\n=== 完了 合計 ${total} 件 ===`);
}

main().catch(e => { console.error(e); process.exit(1); });
