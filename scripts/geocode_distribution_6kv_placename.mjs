/**
 * 未マッチ6.6kV変電所を「地名」として Nominatim 検索して補完
 *
 * 変電所名の多くは地名（町丁名）と同じため、変電所名そのものを
 * 地名として検索することで概算位置を取得する。
 *
 * クエリ順:
 *  1. "{name}, {pref}, 日本"  （最優先・都道府県を絞り込み）
 *  2. "{name}, 日本"           （関西など府県不明の場合）
 *
 * 使い方: node scripts/geocode_distribution_6kv_placename.mjs
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUBS_PATH = path.join(__dirname, "..", "src", "data", "distribution_6kv_substations.json");
const GEO_PATH  = path.join(__dirname, "..", "src", "data", "distribution_6kv_geocoded.json");
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const DELAY_MS  = 1100;  // Nominatim 利用規約: 1 req/s

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 都道府県ごとの緯度経度範囲（誤マッチ除外用）
const PREF_BBOX = {
  "千葉":   [35.0, 139.7, 36.2, 141.0],
  "埼玉":   [35.7, 138.8, 36.4, 140.0],
  "山梨":   [35.2, 138.3, 36.0, 139.2],
  "栃木":   [36.0, 139.2, 37.2, 140.4],
  "神奈川": [35.0, 138.9, 35.8, 139.9],
  "茨城":   [35.6, 139.7, 36.9, 140.9],
  "静岡":   [34.5, 137.4, 35.8, 139.3],
  "宮城":   [37.8, 140.2, 39.0, 141.7],
  "山形":   [37.7, 139.5, 39.0, 140.7],
  "岩手":   [38.5, 140.5, 40.5, 142.1],
  "新潟":   [36.7, 137.7, 38.6, 139.6],
  "福島":   [36.8, 139.0, 37.9, 141.1],
  "秋田":   [38.8, 139.6, 40.5, 141.0],
  "青森":   [40.2, 139.7, 41.6, 141.7],
  "関西":   [33.0, 134.1, 36.0, 137.5],  // 関西全域
};

function inBbox(lat, lng, bbox) {
  if (!bbox) return lat >= 24 && lat <= 46 && lng >= 122 && lng <= 154;
  const [s, w, n, e] = bbox;
  return lat >= s && lat <= n && lng >= w && lng <= e;
}

function buildQueries(name, pref) {
  if (pref === "関西") {
    return [`${name},日本`];  // 日本全国で検索しBBOXで絞り込む
  }
  return [`${name},${pref},日本`, `${name},日本`];
}

async function nominatimSearch(query, bbox) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=jp`;
  const res = await fetch(url, {
    headers: { "User-Agent": "grid-battery-land-search/1.0 (t_naganawa@gue.co.jp)" },
  });
  if (!res.ok) return null;
  const results = await res.json();
  for (const r of results) {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    if (!isNaN(lat) && !isNaN(lng) && inBbox(lat, lng, bbox)) {
      return { lat, lng, displayName: r.display_name };
    }
  }
  return null;
}

async function main() {
  const substations = JSON.parse(fs.readFileSync(SUBS_PATH, "utf-8"));
  const geocoded    = JSON.parse(fs.readFileSync(GEO_PATH, "utf-8"));

  const geoKeys = new Set(geocoded.map(g => `${g.name}|${g.prefecture}`));
  const missed  = substations.filter(s => !geoKeys.has(`${s.name}|${s.prefecture}`));

  console.log(`既存ジオコード: ${geocoded.length} 件`);
  console.log(`未マッチ: ${missed.length} 件 → 地名検索開始\n`);

  let newlyGeocoded = 0;
  let failed = 0;

  for (let i = 0; i < missed.length; i++) {
    const sub = missed[i];
    const queries = buildQueries(sub.name, sub.prefecture);

    process.stdout.write(`[${i+1}/${missed.length}] ${sub.prefecture} ${sub.name} ... `);

    const bbox = PREF_BBOX[sub.prefecture] ?? null;
    let found = false;
    for (const q of queries) {
      try {
        const pos = await nominatimSearch(q, bbox);
        await sleep(DELAY_MS);
        if (pos) {
          geocoded.push({ ...sub, lat: pos.lat, lng: pos.lng, geocodeMethod: "placename" });
          newlyGeocoded++;
          process.stdout.write(`OK  ${pos.lat.toFixed(4)},${pos.lng.toFixed(4)}\n`);
          found = true;
          break;
        }
      } catch (e) {
        process.stdout.write(`エラー: ${e.message}\n`);
        await sleep(5000);
        break;
      }
    }
    if (!found) {
      process.stdout.write(`ミス\n`);
      failed++;
    }

    // 100件ごとに中間保存
    if ((i + 1) % 100 === 0) {
      fs.writeFileSync(GEO_PATH, JSON.stringify(geocoded, null, 2), "utf-8");
      const pct = ((newlyGeocoded / (i + 1)) * 100).toFixed(1);
      console.log(`  [中間保存 ${i+1}/${missed.length}] 合計 ${geocoded.length} 件 (新規+${newlyGeocoded}, マッチ率${pct}%)`);
    }
  }

  fs.writeFileSync(GEO_PATH, JSON.stringify(geocoded, null, 2), "utf-8");
  const pct = ((newlyGeocoded / missed.length) * 100).toFixed(1);
  console.log(`\n=== 完了 ===`);
  console.log(`新規ジオコード: ${newlyGeocoded} 件 (${pct}%)`);
  console.log(`ミス: ${failed} 件`);
  console.log(`合計: ${geocoded.length} 件 → ${GEO_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
