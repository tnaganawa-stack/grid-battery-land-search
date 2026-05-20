/**
 * 未マッチの6.6kV配電用変電所をWebから補完ジオコーディング
 *
 * 戦略（順番に試す）:
 *  1. Nominatim: "{name}変電所, {pref}, 日本"
 *  2. Nominatim: "{name}配電用変電所, {pref}, 日本"
 *  3. Overpass: name~"{name}" (power=substation) within Japan bbox
 *
 * 使い方: node scripts/geocode_distribution_6kv_web.mjs
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUBS_PATH = path.join(__dirname, "..", "src", "data", "distribution_6kv_substations.json");
const GEO_PATH  = path.join(__dirname, "..", "src", "data", "distribution_6kv_geocoded.json");
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS  = "https://overpass-api.de/api/interpreter";

// Nominatim: 1req/s, Overpass: バッチで対応
const NOMINATIM_DELAY_MS = 1100;
const OVERPASS_DELAY_MS  = 3000;

// 都道府県 → Overpass bbox [s, w, n, e]
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
  "京都府": [34.6, 134.9, 35.8, 136.0],
  "兵庫県": [34.2, 134.2, 35.7, 135.5],
  "滋賀県": [34.8, 135.7, 35.7, 136.3],
  "大阪府": [34.2, 135.0, 35.0, 135.9],
  "奈良県": [33.8, 135.5, 34.8, 136.2],
  "和歌山県": [33.4, 135.0, 34.5, 136.0],
  "福井県": [35.4, 135.5, 36.3, 136.8],
  // 関西全体（プレフィックスなしの関西フォールバック用）
  "関西":   [33.0, 134.1, 36.0, 137.5],
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeName(s) {
  return (s || "")
    .replace(/配電用変電所|配電変電所|変電所|変電/g, "")
    .replace(/\s+/g, "")
    .trim();
}

// 関西変電所の都道府県を名前から推定（bboxが広すぎるため）
const KANSAI_PREFS = ["大阪府","兵庫県","京都府","滋賀県","奈良県","和歌山県","福井県"];

async function nominatimSearch(query) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=jp`;
  const res = await fetch(url, {
    headers: { "User-Agent": "grid-battery-land-search/1.0 (t_naganawa@gue.co.jp)" },
  });
  if (!res.ok) return null;
  const results = await res.json();
  if (!results || results.length === 0) return null;
  // 変電所らしい結果を優先（place=industrial, amenity, man_made など）
  for (const r of results) {
    const lat = parseFloat(r.lat);
    const lon = parseFloat(r.lon);
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lng: lon };
  }
  return null;
}

async function overpassNameSearch(name, bbox) {
  const [s, w, n, e] = bbox;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const query = `[out:json][timeout:60];
(
  node["power"="substation"]["name"~"${escaped}"](${s},${w},${n},${e});
  way["power"="substation"]["name"~"${escaped}"](${s},${w},${n},${e});
  relation["power"="substation"]["name"~"${escaped}"](${s},${w},${n},${e});
);
out center;`;
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "grid-battery-land-search/1.0",
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) return null;
  const data = await res.json();
  for (const el of (data.elements || [])) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat && lon) return { lat, lng: lon };
  }
  return null;
}

// 日本全国 bbox（Overpass name検索用）
const JAPAN_BBOX = [30.0, 128.0, 46.0, 148.0];

async function geocodeSingle(sub, overpassCache) {
  const name = sub.name;
  const pref = sub.prefecture;
  const isKansai = (pref === "関西");

  // ── Nominatim (3〜4パターン) ──────────────────
  const queries = isKansai
    ? [
        `${name}変電所,関西,日本`,
        `${name}配電用変電所,日本`,
        `${name}変電所,日本`,
      ]
    : [
        `${name}変電所,${pref},日本`,
        `${name}配電用変電所,${pref},日本`,
        `${name}変電所,日本`,
      ];

  for (const q of queries) {
    const pos = await nominatimSearch(q);
    await sleep(NOMINATIM_DELAY_MS);
    if (pos) return { ...pos, method: "nominatim", query: q };
  }

  // ── Overpass 名前検索 ──────────────────────────
  // 関西は日本全国bbox（名前指定で絞れるので重くない）
  const bbox = isKansai ? JAPAN_BBOX : (PREF_BBOX[pref] ?? JAPAN_BBOX);

  const cacheKey = `${pref}|${name}`;
  if (overpassCache.has(cacheKey)) return overpassCache.get(cacheKey);

  const nameParts = [name, `${name}変電所`, `${name}配電用変電所`];
  for (const part of nameParts) {
    const pos = await overpassNameSearch(part, bbox);
    await sleep(OVERPASS_DELAY_MS);
    if (pos) {
      const result = { ...pos, method: "overpass-name", query: part };
      overpassCache.set(cacheKey, result);
      return result;
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
  console.log(`未マッチ: ${missed.length} 件 → 補完開始\n`);

  const overpassCache = new Map();
  let newlyGeocoded = 0;
  let failed = 0;

  for (let i = 0; i < missed.length; i++) {
    const sub = missed[i];
    process.stdout.write(`[${i+1}/${missed.length}] ${sub.prefecture} ${sub.name} ... `);

    try {
      const pos = await geocodeSingle(sub, overpassCache);
      if (pos) {
        geocoded.push({ ...sub, lat: pos.lat, lng: pos.lng });
        newlyGeocoded++;
        process.stdout.write(`OK (${pos.method})\n`);
      } else {
        failed++;
        process.stdout.write(`ミス\n`);
      }
    } catch (e) {
      failed++;
      process.stdout.write(`エラー: ${e.message}\n`);
      await sleep(5000);
    }

    // 50件ごとに中間保存
    if ((i + 1) % 50 === 0) {
      fs.writeFileSync(GEO_PATH, JSON.stringify(geocoded, null, 2), "utf-8");
      console.log(`  [中間保存] 合計 ${geocoded.length} 件 (新規+${newlyGeocoded})`);
    }
  }

  fs.writeFileSync(GEO_PATH, JSON.stringify(geocoded, null, 2), "utf-8");
  console.log(`\n=== 完了 ===`);
  console.log(`新規ジオコード: ${newlyGeocoded} 件`);
  console.log(`ミス: ${failed} 件`);
  console.log(`合計: ${geocoded.length} 件 → ${GEO_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
