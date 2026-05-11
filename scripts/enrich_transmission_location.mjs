/**
 * 既存の送電線JSONに location フィールドを付加するスクリプト。
 * OSM way ID を Overpass API に問い合わせ、power/location タグを取得する。
 *
 * 使い方: node scripts/enrich_transmission_location.mjs
 *
 * location の判定ルール:
 *   - tags.power === "cable" → "underground"
 *   - tags.location === "underground" → "underground"
 *   - それ以外 → "overhead"（デフォルト）
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, "..", "src", "data");
const OVERPASS  = "https://overpass-api.de/api/interpreter";
const BATCH     = 300;   // 1クエリあたりのway ID数
const DELAY_MS  = 2000;  // バッチ間の待機時間

const JSON_FILES = [
  "transmission_lines_kanto.json",
  "transmission_lines_gunma.json",
  "transmission_lines_66kv_chiba.json",
  "transmission_lines_66kv_saitama.json",
  "transmission_lines_66kv_yamanashi.json",
  "transmission_lines_66kv_tochigi.json",
  "transmission_lines_66kv_kanagawa.json",
  "transmission_lines_66kv_ibaraki.json",
  "transmission_lines_66kv_nagano.json",
  "transmission_lines_66kv_shizuoka.json",
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** "osm-66kv-12345678" または "osm-12345678" → 12345678 */
function extractWayId(id) {
  const parts = id.split("-");
  return parseInt(parts[parts.length - 1], 10);
}

/** OSM location の解釈 */
function resolveLocation(tags) {
  if (!tags) return "overhead";
  if (tags.power === "cable") return "underground";
  if (tags.location === "underground") return "underground";
  if (tags.location === "underwater") return "underground";
  return "overhead";
}

async function fetchLocations(wayIds) {
  const idList = wayIds.join(",");
  const query  = `[out:json][timeout:60];\nway(id:${idList});\nout tags;`;

  const res = await fetch(OVERPASS, {
    method:  "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":   "grid-battery-land-search/1.0",
    },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();

  const map = new Map();
  for (const el of json.elements ?? []) {
    map.set(el.id, resolveLocation(el.tags));
  }
  return map;
}

async function processFile(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.log(`  skip (not found): ${filename}`);
    return;
  }

  const lines = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  // location 未設定の線だけ対象
  const toFetch = lines.filter(l => !l.location);
  if (toFetch.length === 0) {
    console.log(`  ${filename}: all already enriched (${lines.length} lines)`);
    return;
  }

  console.log(`  ${filename}: ${toFetch.length}/${lines.length} lines to fetch`);

  // バッチに分割して取得
  const locationMap = new Map();
  for (let i = 0; i < toFetch.length; i += BATCH) {
    const batch   = toFetch.slice(i, i + BATCH);
    const wayIds  = batch.map(l => extractWayId(l.id)).filter(n => !isNaN(n));
    if (wayIds.length === 0) continue;

    try {
      const batchMap = await fetchLocations(wayIds);
      for (const line of batch) {
        const wayId = extractWayId(line.id);
        if (batchMap.has(wayId)) {
          locationMap.set(line.id, batchMap.get(wayId));
        }
      }
      console.log(`    batch ${Math.floor(i/BATCH)+1}: ${batchMap.size} tags fetched`);
    } catch (err) {
      console.error(`    batch error: ${err.message}`);
    }

    if (i + BATCH < toFetch.length) await sleep(DELAY_MS);
  }

  // JSON を更新
  let updated = 0;
  const enriched = lines.map(l => {
    if (locationMap.has(l.id)) {
      updated++;
      return { ...l, location: locationMap.get(l.id) };
    }
    // Overpass から取得できなかった場合は overhead をデフォルト設定
    return { ...l, location: l.location ?? "overhead" };
  });

  fs.writeFileSync(filePath, JSON.stringify(enriched, null, 2), "utf-8");
  console.log(`  ${filename}: updated ${updated} lines, defaulted ${toFetch.length - updated} to overhead`);
}

async function main() {
  console.log("=== 送電線 location 取得開始 ===\n");

  for (const filename of JSON_FILES) {
    console.log(`[${filename}]`);
    await processFile(filename);
    await sleep(DELAY_MS);
  }

  console.log("\n=== 完了 ===");
}

main().catch(console.error);
