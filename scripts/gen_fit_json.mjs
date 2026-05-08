/**
 * Fast parallel geocoding script to generate src/data/fit_municipalities.json
 * Processes all 10 prefectures simultaneously with concurrent GSI geocoding
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUT_PATH = path.join(ROOT, "src", "data", "fit_municipalities.json");

const XLSX_FILES = {
  "茨城県": "08.茨城県_202603.xlsx",
  "栃木県": "09.栃木県_202603.xlsx",
  "群馬県": "10.群馬県_202603.xlsx",
  "埼玉県": "11.埼玉県_202603.xlsx",
  "千葉県": "12.千葉県_202603.xlsx",
  "東京都": "13.東京都_202603.xlsx",
  "神奈川県": "14.神奈川県_202603.xlsx",
  "山梨県": "19.山梨県_202603.xlsx",
  "長野県": "20.長野県_202603.xlsx",
  "静岡県": "22.静岡県_202603.xlsx",
};

// Fallback coordinates for municipalities that fail geocoding
const PREF_CENTERS = {
  "茨城県": { lat: 36.341, lng: 140.447 },
  "栃木県": { lat: 36.565, lng: 139.883 },
  "群馬県": { lat: 36.391, lng: 139.060 },
  "埼玉県": { lat: 35.857, lng: 139.649 },
  "千葉県": { lat: 35.605, lng: 140.123 },
  "東京都": { lat: 35.689, lng: 139.692 },
  "神奈川県": { lat: 35.447, lng: 139.642 },
  "山梨県": { lat: 35.664, lng: 138.569 },
  "長野県": { lat: 36.651, lng: 138.181 },
  "静岡県": { lat: 34.977, lng: 138.383 },
};

function parsePrefMuni(address) {
  if (!address || typeof address !== "string") return null;
  const prefMatch = address.match(/^(.+?[都道府県])/);
  if (!prefMatch) return null;
  const pref = prefMatch[1];
  const rest = address.slice(pref.length);
  const muniMatch = rest.match(/^(?:[^市区町村]*郡)?([^市区町村]*[市区町村]+)/);
  if (!muniMatch) return null;
  return { pref, muni: muniMatch[1] };
}

// Excelシリアル値 → 年
function excelSerialToYear(serial) {
  if (!serial || isNaN(serial)) return null;
  const ms = (Number(serial) - 25569) * 86400 * 1000;
  return new Date(ms).getFullYear();
}

// 運転開始年を取得（列11:予定日シリアル値、列12:報告年月文字列）
function getOperationYear(row) {
  // 列12: "2022年4月" 形式（実績）
  const reported = String(row[12] ?? "").trim();
  if (reported && reported !== "-") {
    const m = reported.match(/(\d{4})年/);
    if (m) return parseInt(m[1]);
  }
  // 列11: Excelシリアル値（予定）
  const planned = row[11];
  if (planned && planned !== "-" && !isNaN(planned)) {
    return excelSerialToYear(planned);
  }
  return null; // 不明
}

function parseXlsx(prefName, filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`[parse] ファイルなし: ${filePath}`);
    return new Map();
  }
  const wb = XLSX.readFile(filePath, { sheetRows: 0, cellText: false, cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  const muniMap = new Map();
  let skipped = 0;

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    const type = String(row[5] ?? "").trim();
    const kwRaw = row[6];
    const address = String(row[7] ?? "").trim();
    if (!address) continue;

    // 運転開始年フィルター: 2024年以前のみ（不明は除外）
    const opYear = getOperationYear(row);
    if (opYear === null || opYear > 2024) { skipped++; continue; }

    const kw = parseFloat(String(kwRaw).replace(/,/g, "")) || 0;
    const parsed = parsePrefMuni(address);
    if (!parsed) continue;

    const muni = parsed.muni;
    const key = `${prefName}/${muni}`;

    if (!muniMap.has(key)) {
      muniMap.set(key, { pref: prefName, muni, facilityTypes: new Set(), totalKw: 0, count: 0 });
    }
    const entry = muniMap.get(key);
    if (type) entry.facilityTypes.add(type);
    entry.totalKw += kw;
    entry.count++;
  }

  console.log(`[parse] ${prefName}: ${muniMap.size}市区町村 (2024年以前採用, ${skipped}件除外)`);
  return muniMap;
}

async function geocode(pref, muni) {
  const query = encodeURIComponent(`${pref}${muni}`);
  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${query}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const [lng, lat] = data[0].geometry.coordinates;
    return { lat, lng };
  } catch {
    return null;
  }
}

async function geocodeBatch(entries, concurrency = 10) {
  const results = new Array(entries.length).fill(null);
  let idx = 0;

  async function worker() {
    while (idx < entries.length) {
      const i = idx++;
      const { pref, muni } = entries[i];
      results[i] = await geocode(pref, muni);
      if (results[i]) {
        process.stdout.write(".");
      } else {
        process.stdout.write("x");
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log("");
  return results;
}

async function main() {
  console.log("[gen] FIT市区町村JSON生成開始...");
  const startTime = Date.now();

  // Step 1: Parse all XLSX files
  const allMuniMaps = Object.entries(XLSX_FILES).map(([pref, file]) => parseXlsx(pref, file));

  // Step 2: Collect all unique municipalities
  const allEntries = [];
  for (const muniMap of allMuniMaps) {
    for (const [, entry] of muniMap) {
      allEntries.push(entry);
    }
  }
  console.log(`[gen] 合計: ${allEntries.length}市区町村をジオコーディング中...`);

  // Step 3: Geocode all in parallel with concurrency=15
  const coords = await geocodeBatch(allEntries, 15);

  // Step 4: Build output structure
  const output = {};
  for (let i = 0; i < allEntries.length; i++) {
    const entry = allEntries[i];
    const coord = coords[i] ?? PREF_CENTERS[entry.pref] ?? { lat: 35.6, lng: 139.7 };

    if (!output[entry.pref]) output[entry.pref] = [];
    output[entry.pref].push({
      prefecture: entry.pref,
      municipality: entry.muni,
      coordinates: coord,
      siteCount: entry.count,
      totalCapacityKw: Math.round(entry.totalKw),
      facilityTypes: [...entry.facilityTypes],
    });
  }

  // Step 5: Sort each prefecture by totalCapacityKw desc
  for (const pref of Object.keys(output)) {
    output[pref].sort((a, b) => b.totalCapacityKw - a.totalCapacityKw);
    console.log(`[gen] ${pref}: ${output[pref].length}市区町村`);
  }

  // Step 6: Write JSON
  fs.mkdirSync(path.join(ROOT, "src", "data"), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), "utf-8");

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const total = Object.values(output).reduce((s, arr) => s + arr.length, 0);
  console.log(`[gen] 完了: ${total}市区町村 → ${OUT_PATH} (${elapsed}秒)`);
}

main().catch((e) => { console.error("[gen] エラー:", e); process.exit(1); });
