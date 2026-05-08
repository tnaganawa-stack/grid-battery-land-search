/**
 * フォールバック座標の市区町村を再ジオコーディング
 * GSI API → Nominatim の順でフォールバック
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_PATH = path.join(ROOT, "src", "data", "fit_municipalities.json");

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

function isFallback(coord, pref) {
  const fb = PREF_CENTERS[pref];
  return fb && coord.lat === fb.lat && coord.lng === fb.lng;
}

async function geocodeGsi(pref, muni) {
  const q = encodeURIComponent(`${pref}${muni}`);
  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${q}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const coords = data[0].geometry?.coordinates;
    if (!coords || coords.length < 2) return null;
    return { lat: coords[1], lng: coords[0] };
  } catch { return null; }
}

async function geocodeNominatim(pref, muni) {
  const q = encodeURIComponent(`${muni}, ${pref}, Japan`);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=jp`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "grid-battery-land-search/1.0" }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch { return null; }
}

async function geocodeWithRetry(pref, muni) {
  // GSI を最大2回試行
  for (let i = 0; i < 2; i++) {
    const c = await geocodeGsi(pref, muni);
    if (c) return { coord: c, source: "gsi" };
    await new Promise(r => setTimeout(r, 300));
  }
  // Nominatim フォールバック
  const c = await geocodeNominatim(pref, muni);
  if (c) return { coord: c, source: "nominatim" };
  return null;
}

async function processBatch(entries, concurrency = 5) {
  const results = new Array(entries.length).fill(null);
  let idx = 0;
  async function worker() {
    while (idx < entries.length) {
      const i = idx++;
      const { pref, muni } = entries[i];
      results[i] = await geocodeWithRetry(pref, muni);
      const r = results[i];
      process.stdout.write(r ? (r.source === "gsi" ? "." : "N") : "x");
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  process.stdout.write("\n");
  return results;
}

async function main() {
  const raw = fs.readFileSync(OUT_PATH, "utf-8");
  const data = JSON.parse(raw);

  // フォールバック座標の市区町村を収集
  const targets = [];
  for (const [pref, munis] of Object.entries(data)) {
    for (let i = 0; i < munis.length; i++) {
      if (isFallback(munis[i].coordinates, pref)) {
        targets.push({ pref, muni: munis[i].municipality, prefIdx: pref, muniIdx: i });
      }
    }
  }
  console.log(`[regeocode] フォールバック ${targets.length}件 を再ジオコーディング中...`);
  console.log("  . = GSI成功  N = Nominatim成功  x = 失敗");

  const results = await processBatch(targets, 5);

  let gsiOk = 0, nomOk = 0, failed = 0;
  for (let i = 0; i < targets.length; i++) {
    const { pref, muniIdx } = targets[i];
    const r = results[i];
    if (r) {
      data[pref][muniIdx].coordinates = r.coord;
      if (r.source === "gsi") gsiOk++;
      else nomOk++;
    } else {
      failed++;
    }
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 2), "utf-8");
  console.log(`[regeocode] 完了 GSI=${gsiOk} Nominatim=${nomOk} 失敗=${failed}`);
  console.log(`[regeocode] 保存: ${OUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
