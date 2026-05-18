/**
 * 関西電力エリアの「上位系統増強必要地域」市区町村境界を Nominatim から取得し
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
const DELAY_MS  = 1200;  // Nominatim 利用規約: 1 req/s 以下

// 上位系統増強必要地域の市区町村（PDF: 2026年2月時点）
const AREAS = [
  {
    region: "京都府北部",
    municipalities: [
      { name: "伊根町",   pref: "京都府" },
      { name: "与謝野町", pref: "京都府" },
      { name: "京丹後市", pref: "京都府" },
      { name: "宮津市",   pref: "京都府" },
      { name: "福知山市", pref: "京都府" },
      { name: "舞鶴市",   pref: "京都府" },
      { name: "綾部市",   pref: "京都府" },
    ],
  },
  {
    region: "兵庫県北部",
    municipalities: [
      { name: "丹波市",   pref: "兵庫県" },
      { name: "豊岡市",   pref: "兵庫県" },
      { name: "養父市",   pref: "兵庫県" },
      { name: "朝来市",   pref: "兵庫県" },
      { name: "香美町",   pref: "兵庫県" },
      { name: "新温泉町", pref: "兵庫県" },
    ],
  },
  {
    region: "兵庫県南部（播磨）",
    municipalities: [
      { name: "加古川市", pref: "兵庫県" },
      { name: "高砂市",   pref: "兵庫県" },
      { name: "小野市",   pref: "兵庫県" },
      { name: "加西市",   pref: "兵庫県" },
      { name: "加東市",   pref: "兵庫県" },
      { name: "播磨町",   pref: "兵庫県" },
      { name: "多可町",   pref: "兵庫県" },
    ],
  },
  {
    region: "滋賀県湖東",
    municipalities: [
      { name: "彦根市",   pref: "滋賀県" },
      { name: "長浜市",   pref: "滋賀県" },
      { name: "東近江市", pref: "滋賀県" },
      { name: "米原市",   pref: "滋賀県" },
      { name: "愛荘町",   pref: "滋賀県" },
      { name: "豊郷町",   pref: "滋賀県" },
      { name: "甲良町",   pref: "滋賀県" },
      { name: "多賀町",   pref: "滋賀県" },
    ],
  },
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchPolygon(name, pref) {
  const q   = encodeURIComponent(`${name}, ${pref}, 日本`);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=geojson&polygon_geojson=1&limit=3&countrycodes=jp`;
  const res = await fetch(url, {
    headers: { "User-Agent": "grid-battery-land-search/1.0 (contact: t_naganawa@gue.co.jp)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const geojson = await res.json();
  if (!geojson.features || geojson.features.length === 0) return null;

  // 行政区域を優先（Polygon/MultiPolygon のみ）
  const polys = geojson.features.filter(f =>
    f.geometry &&
    (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
  );
  if (polys.length === 0) return null;

  // admin level が高いもの（市区町村レベル）を優先
  polys.sort((a, b) => {
    const ra = parseInt(a.properties?.["place:importance"] ?? "0");
    const rb = parseInt(b.properties?.["place:importance"] ?? "0");
    return rb - ra;
  });
  return polys[0];
}

async function main() {
  console.log("=== 関西上位系統増強必要地域 市区町村境界取得 (Nominatim) ===\n");

  const features = [];

  for (const area of AREAS) {
    console.log(`\n[${area.region}]`);
    for (const muni of area.municipalities) {
      process.stdout.write(`  ${muni.name} ... `);
      try {
        const feat = await fetchPolygon(muni.name, muni.pref);
        if (!feat) {
          console.log("(取得なし)");
        } else {
          const coords = feat.geometry.type === "Polygon"
            ? feat.geometry.coordinates[0]
            : feat.geometry.coordinates[0][0];
          const lngs = coords.map(c => c[0]);
          const lats  = coords.map(c => c[1]);
          const wkm  = ((Math.max(...lngs) - Math.min(...lngs)) * 111 * Math.cos(35.5 * Math.PI / 180)).toFixed(1);
          const hkm  = ((Math.max(...lats)  - Math.min(...lats))  * 111).toFixed(1);
          console.log(`OK  ${wkm}km x ${hkm}km  (${coords.length}pts)`);
          features.push({
            type: "Feature",
            properties: {
              name:       muni.name,
              region:     area.region,
              prefecture: muni.pref,
            },
            geometry: feat.geometry,
          });
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
