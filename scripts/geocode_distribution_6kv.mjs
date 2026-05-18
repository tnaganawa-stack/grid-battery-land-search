/**
 * 6.6kV 配電用変電所のジオコーディング (lat/lng 付与)
 *
 * distribution_6kv_substations.json の変電所名を
 * OSM Overpass API の power=substation で照合して lat/lng を取得する。
 *
 * 出力: src/data/distribution_6kv_geocoded.json
 *   [{ name, prefecture, lat, lng, primaryKv, availableMw, source }, ...]
 *
 * 使い方: node scripts/geocode_distribution_6kv.mjs
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN_PATH  = path.join(__dirname, "..", "src", "data", "distribution_6kv_substations.json");
const OUT_PATH = path.join(__dirname, "..", "src", "data", "distribution_6kv_geocoded.json");
const OVERPASS = "https://overpass-api.de/api/interpreter";
const DELAY_MS = 3000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// エリア別 bounding box [south, west, north, east]
const REGION_BBOX = {
  // TEPCO (関東 + 静岡)
  "千葉":   [35.0, 139.7, 36.2, 141.0],
  "埼玉":   [35.7, 138.8, 36.4, 140.0],
  "山梨":   [35.2, 138.3, 36.0, 139.2],
  "栃木":   [36.0, 139.2, 37.2, 140.4],
  "神奈川": [35.0, 138.9, 35.8, 139.9],
  "茨城":   [35.6, 139.7, 36.9, 140.9],
  "静岡":   [34.5, 137.4, 35.8, 139.3],
  // 東北
  "宮城":   [37.8, 140.2, 39.0, 141.7],
  "山形":   [37.7, 139.5, 39.0, 140.7],
  "岩手":   [38.5, 140.5, 40.5, 142.1],
  "新潟":   [36.7, 137.7, 38.6, 139.6],
  "福島":   [36.8, 139.0, 37.9, 141.1],
  "秋田":   [38.8, 139.6, 40.5, 141.0],
  "青森":   [40.2, 139.7, 41.6, 141.7],
  // 関西 (7府県まとめて)
  "関西":   [33.0, 134.1, 36.0, 137.5],
};

async function fetchSubstations(bbox) {
  const [s, w, n, e] = bbox;
  const query = `[out:json][timeout:90];
(
  node["power"="substation"](${s},${w},${n},${e});
  way["power"="substation"](${s},${w},${n},${e});
  relation["power"="substation"](${s},${w},${n},${e});
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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.elements || [];
}

function normalizeName(s) {
  return (s || "")
    .replace(/変電所|配電変電所|配電用変電所|変電/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function matchSubstation(pdfName, osmElements) {
  const pdfNorm = normalizeName(pdfName);
  // 完全一致 → 部分一致 の順で試す
  for (const el of osmElements) {
    const tags = el.tags || {};
    const names = [
      tags.name, tags["name:ja"], tags["name:en"],
      tags.official_name, tags["official_name:ja"],
    ].filter(Boolean);

    for (const n of names) {
      const norm = normalizeName(n);
      if (norm === pdfNorm || norm.startsWith(pdfNorm) || pdfNorm.startsWith(norm)) {
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (lat && lng) return { lat, lng };
      }
    }
  }
  return null;
}

async function main() {
  const substations = JSON.parse(fs.readFileSync(IN_PATH, "utf-8"));
  console.log(`入力: ${substations.length} 件`);

  // 都道府県 (prefecture) 別にグループ化
  const byPref = {};
  for (const sub of substations) {
    const pref = sub.prefecture;
    byPref[pref] = byPref[pref] || [];
    byPref[pref].push(sub);
  }

  const geocoded = [];
  let totalMatched = 0;
  let totalMissed = 0;

  for (const [pref, subs] of Object.entries(byPref)) {
    const bbox = REGION_BBOX[pref];
    if (!bbox) {
      console.log(`  [SKIP] ${pref}: bbox未定義`);
      continue;
    }
    console.log(`\n[${pref}] ${subs.length} 件 → Overpass 問い合わせ中...`);

    let osmEls;
    try {
      osmEls = await fetchSubstations(bbox);
      console.log(`  OSM 変電所: ${osmEls.length} 件取得`);
    } catch (e) {
      console.log(`  [ERR] ${e.message}`);
      await sleep(DELAY_MS);
      continue;
    }

    let matched = 0;
    let missed = 0;
    for (const sub of subs) {
      const pos = matchSubstation(sub.name, osmEls);
      if (pos) {
        geocoded.push({ ...sub, lat: pos.lat, lng: pos.lng });
        matched++;
      } else {
        missed++;
      }
    }
    console.log(`  マッチ: ${matched} / ミス: ${missed}`);
    totalMatched += matched;
    totalMissed += missed;

    if (pref !== Object.keys(byPref).at(-1)) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n=== 結果 ===`);
  console.log(`マッチ合計: ${totalMatched} / ミス合計: ${totalMissed}`);
  console.log(`マッチ率: ${(totalMatched/(totalMatched+totalMissed)*100).toFixed(1)}%`);

  fs.writeFileSync(OUT_PATH, JSON.stringify(geocoded, null, 2), "utf-8");
  console.log(`保存: ${OUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
