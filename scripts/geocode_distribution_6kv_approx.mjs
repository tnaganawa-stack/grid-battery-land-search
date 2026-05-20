/**
 * 未マッチ6.6kV変電所を地名近傍の推定座標で補完
 *
 * 都道府県BBOXで誤マッチを除外しつつ、地名として検索した最初のヒットを
 * 「推定位置」として geocodeMethod: "approximate" で保存する。
 *
 * 使い方: node scripts/geocode_distribution_6kv_approx.mjs
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUBS_PATH = path.join(__dirname, "..", "src", "data", "distribution_6kv_substations.json");
const GEO_PATH  = path.join(__dirname, "..", "src", "data", "distribution_6kv_geocoded.json");
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const DELAY_MS  = 1100;

// 都道府県ごとの緯度経度範囲
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
  "関西":   [33.0, 134.1, 36.0, 137.5],
};

// 都道府県の中心座標（どうしてもヒットしない場合のデフォルト）
const PREF_CENTER = {
  "千葉":   [35.6, 140.1], "埼玉":   [35.9, 139.6], "山梨":   [35.6, 138.6],
  "栃木":   [36.6, 139.8], "神奈川": [35.4, 139.4], "茨城":   [36.3, 140.4],
  "静岡":   [35.0, 138.4], "宮城":   [38.3, 140.9], "山形":   [38.3, 140.2],
  "岩手":   [39.4, 141.3], "新潟":   [37.6, 138.9], "福島":   [37.4, 140.5],
  "秋田":   [39.7, 140.3], "青森":   [40.8, 140.7], "関西":   [34.7, 135.5],
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function inBbox(lat, lng, bbox) {
  const [s, w, n, e] = bbox;
  return lat >= s && lat <= n && lng >= w && lng <= e;
}

async function searchNominatim(query, bbox, retries = 3) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=jp`;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "grid-battery-land-search/1.0 (t_naganawa@gue.co.jp)" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const results = await res.json();
      for (const r of results) {
        const lat = parseFloat(r.lat);
        const lng = parseFloat(r.lon);
        if (!isNaN(lat) && !isNaN(lng) && inBbox(lat, lng, bbox)) {
          return { lat, lng };
        }
      }
      return null;
    } catch (e) {
      if (attempt < retries - 1) {
        process.stdout.write(`(retry${attempt + 1}) `);
        await sleep(3000 * (attempt + 1));
      }
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
  console.log(`未マッチ: ${missed.length} 件 → 推定位置付与開始\n`);

  let newlyGeocoded = 0;
  let usedDefault = 0;

  for (let i = 0; i < missed.length; i++) {
    const sub = missed[i];
    const bbox = PREF_BBOX[sub.prefecture];
    if (!bbox) {
      console.log(`[${i+1}/${missed.length}] ${sub.prefecture} ${sub.name} → BBOX未定義でスキップ`);
      continue;
    }

    process.stdout.write(`[${i+1}/${missed.length}] ${sub.prefecture} ${sub.name} ... `);

    // Nominatim で地名検索（都道府県BBOX内に限定）
    const queries = sub.prefecture === "関西"
      ? [`${sub.name},日本`]
      : [`${sub.name},${sub.prefecture},日本`, `${sub.name},日本`];

    let pos = null;
    for (const q of queries) {
      pos = await searchNominatim(q, bbox);
      await sleep(DELAY_MS);
      if (pos) break;
    }

    if (pos) {
      geocoded.push({ ...sub, lat: pos.lat, lng: pos.lng, geocodeMethod: "approximate" });
      newlyGeocoded++;
      process.stdout.write(`推定OK  ${pos.lat.toFixed(4)},${pos.lng.toFixed(4)}\n`);
    } else {
      // どうしてもヒットしない場合は都道府県中心にランダム散布
      const center = PREF_CENTER[sub.prefecture];
      if (center) {
        const jitter = () => (Math.random() - 0.5) * 0.3;
        const lat = center[0] + jitter();
        const lng = center[1] + jitter();
        geocoded.push({ ...sub, lat, lng, geocodeMethod: "default-region" });
        usedDefault++;
        process.stdout.write(`デフォルト (${sub.prefecture}中心付近)\n`);
      } else {
        process.stdout.write(`スキップ\n`);
      }
    }

    // 100件ごとに中間保存
    if ((i + 1) % 100 === 0) {
      fs.writeFileSync(GEO_PATH, JSON.stringify(geocoded, null, 2), "utf-8");
      console.log(`  [中間保存 ${i+1}/${missed.length}] 合計 ${geocoded.length} 件 (推定+${newlyGeocoded}, デフォルト+${usedDefault})`);
    }
  }

  fs.writeFileSync(GEO_PATH, JSON.stringify(geocoded, null, 2), "utf-8");
  console.log(`\n=== 完了 ===`);
  console.log(`推定位置: ${newlyGeocoded} 件`);
  console.log(`デフォルト(府県中心): ${usedDefault} 件`);
  console.log(`合計: ${geocoded.length} 件 → ${GEO_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
