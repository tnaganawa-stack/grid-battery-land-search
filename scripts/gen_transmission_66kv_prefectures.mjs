/**
 * 県別66kV送電線静的JSON生成スクリプト
 * Overpass APIから各県の66kV以上の送電線を取得して静的JSONに保存する
 *
 * 使い方: node scripts/gen_transmission_66kv_prefectures.mjs
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "src", "data");

// 各県のバウンディングボックス [south, west, north, east]
const PREFECTURES = [
  { name: "chiba",      label: "千葉",   bbox: [34.9,  139.7, 36.1,  141.0] },
  { name: "saitama",    label: "埼玉",   bbox: [35.7,  138.7, 36.35, 140.0] },
  { name: "yamanashi",  label: "山梨",   bbox: [35.1,  138.1, 36.0,  139.2] },
  { name: "tochigi",    label: "栃木",   bbox: [36.2,  139.3, 37.2,  140.4] },
  { name: "kanagawa",   label: "神奈川", bbox: [35.1,  138.9, 35.7,  140.0] },
  { name: "ibaraki",    label: "茨城",   bbox: [35.7,  139.7, 36.8,  140.9] },
  { name: "nagano",     label: "長野",   bbox: [35.15, 136.9, 37.0,  139.1] },
  { name: "shizuoka",   label: "静岡",   bbox: [34.55, 137.3, 35.55, 139.2] },
];

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DELAY_MS = 3000; // レートリミット対策

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function buildQuery(bbox) {
  const [s, w, n, e] = bbox;
  return `[out:json][timeout:60];
(
  way["power"="line"]["voltage"~"^(66000|77000|154000|275000|500000)$"](${s},${w},${n},${e});
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

    lines.push({
      id,
      name: rawName,
      voltageKv,
      path: way.geometry.map(pt => ({ lat: pt.lat, lng: pt.lon })),
    });
  }

  console.log(`[${label}] ${lines.length} 件の送電線 (66kV: ${lines.filter(l => l.voltageKv === 66).length}, 77kV: ${lines.filter(l => l.voltageKv === 77).length}, 154kV: ${lines.filter(l => l.voltageKv === 154).length})`);
  return lines;
}

async function main() {
  for (const pref of PREFECTURES) {
    const outPath = path.join(OUT_DIR, `transmission_lines_66kv_${pref.name}.json`);

    // 既存ファイルがある場合はスキップ
    if (fs.existsSync(outPath)) {
      const existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
      console.log(`[${pref.label}] 既存ファイル使用 (${existing.length} 件) → スキップ`);
      continue;
    }

    try {
      const lines = await fetchPrefecture(pref);
      fs.writeFileSync(outPath, JSON.stringify(lines, null, 2), "utf-8");
      console.log(`[${pref.label}] 保存完了: ${outPath}`);
    } catch (err) {
      console.error(`[${pref.label}] エラー: ${err.message}`);
    }

    console.log(`${DELAY_MS / 1000}秒待機中...`);
    await sleep(DELAY_MS);
  }

  console.log("\n全県処理完了。");
}

main().catch(console.error);
