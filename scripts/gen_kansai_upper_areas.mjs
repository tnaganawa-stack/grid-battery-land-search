/**
 * 関西電力エリアの「上位系統増強必要地域」市区町村境界を OSM から取得し
 * src/data/kansai_upper_areas.json に出力する。
 *
 * 出典: 蓄電池連系に伴い大規模な上位系統増強が必要となる地域マップ（関西電力送配電 2026年2月）
 *
 * 使い方: node scripts/gen_kansai_upper_areas.mjs
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH  = path.join(__dirname, "..", "src", "data", "kansai_upper_areas.json");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DELAY_MS = 3000;

// 上位系統増強必要地域の市区町村（PDF: 2026年2月時点）
const AREAS = [
  {
    region: "京都府北部",
    municipalities: [
      "伊根町", "与謝野町", "京丹後市", "宮津市", "福知山市", "舞鶴市", "綾部市",
    ],
    prefecture: "京都府",
  },
  {
    region: "兵庫県北部",
    municipalities: [
      "丹波市", "豊岡市", "養父市", "朝来市", "香美町", "新温泉町",
    ],
    prefecture: "兵庫県",
  },
  {
    region: "兵庫県南部（播磨）",
    municipalities: [
      "加古川市", "高砂市", "小野市", "加西市", "加東市", "播磨町", "多可町",
    ],
    prefecture: "兵庫県",
  },
  {
    region: "滋賀県湖東",
    municipalities: [
      "彦根市", "長浜市", "東近江市", "米原市", "愛荘町", "豊郷町", "甲良町", "多賀町",
    ],
    prefecture: "滋賀県",
  },
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function buildQuery(name, prefecture) {
  return `[out:json][timeout:60];
area["name"="${prefecture}"]["admin_level"="4"]->.pref;
(
  relation["admin_level"~"^(7|8)$"]["name"="${name}"](area.pref);
);
out body geom;`;
}

async function fetchMunicipality(name, prefecture) {
  const query = buildQuery(name, prefecture);
  const res = await fetch(OVERPASS_URL, {
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

function relationToPolygons(rel) {
  // outer メンバーの geometry から座標を抽出してポリゴンを組み立てる
  const outerMembers = (rel.members || []).filter(m => m.role === "outer" && m.geometry);
  if (outerMembers.length === 0) {
    // geomが直接ある場合
    if (rel.geometry && rel.geometry.length > 0) {
      return [rel.geometry.map(pt => [pt.lon, pt.lat])];
    }
    return [];
  }

  // 連結してリングを組み立てる
  const segments = outerMembers.map(m => m.geometry.map(pt => [pt.lon, pt.lat]));
  const rings = [];

  // 単純にセグメントを順番に連結（近似的アプローチ）
  let current = segments.shift();
  while (current) {
    const last = current[current.length - 1];
    const nextIdx = segments.findIndex(seg => {
      const d0 = Math.hypot(seg[0][0] - last[0], seg[0][1] - last[1]);
      const d1 = Math.hypot(seg[seg.length - 1][0] - last[0], seg[seg.length - 1][1] - last[1]);
      return Math.min(d0, d1) < 0.001;
    });
    if (nextIdx === -1) {
      rings.push(current);
      current = segments.shift();
    } else {
      const [next] = segments.splice(nextIdx, 1);
      const d0 = Math.hypot(next[0][0] - last[0], next[0][1] - last[1]);
      const d1 = Math.hypot(next[next.length - 1][0] - last[0], next[next.length - 1][1] - last[1]);
      current = [...current, ...(d0 <= d1 ? next : [...next].reverse())];
    }
  }
  return rings;
}

async function main() {
  console.log("=== 関西上位系統増強必要地域 市区町村境界取得 ===\n");

  const features = [];

  for (const area of AREAS) {
    console.log(`\n[${area.region}]`);
    for (const muni of area.municipalities) {
      process.stdout.write(`  ${muni} ... `);
      try {
        const elements = await fetchMunicipality(muni, area.prefecture);
        const rels = elements.filter(e => e.type === "relation");
        if (rels.length === 0) {
          console.log("(取得なし)");
        } else {
          const rel = rels[0];
          const polygons = relationToPolygons(rel);
          if (polygons.length > 0) {
            features.push({
              type: "Feature",
              properties: {
                name: muni,
                region: area.region,
                prefecture: area.prefecture,
              },
              geometry: polygons.length === 1
                ? { type: "Polygon",      coordinates: [polygons[0]] }
                : { type: "MultiPolygon", coordinates: polygons.map(p => [p]) },
            });
            console.log(`OK (${polygons.length} ring(s))`);
          } else {
            console.log("(境界データなし)");
          }
        }
      } catch (e) {
        console.log(`エラー: ${e.message}`);
      }
      await sleep(DELAY_MS);
    }
  }

  const geojson = { type: "FeatureCollection", features };
  fs.writeFileSync(OUT_PATH, JSON.stringify(geojson, null, 2), "utf-8");
  console.log(`\n=== 完了: ${features.length} 市区町村 → ${OUT_PATH} ===`);
}

main().catch(e => { console.error(e); process.exit(1); });
