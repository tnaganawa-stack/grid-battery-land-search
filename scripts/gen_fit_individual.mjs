/**
 * 個別FIT設備データ生成
 * 各設備に市区町村重心+決定論的ジッターを付与して都道府県別JSONに保存
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
const OUT_DIR = path.join(ROOT, "src", "data", "fit_individual");
const MUNI_JSON = path.join(ROOT, "src", "data", "fit_municipalities.json");
const SUBS_JSON = path.join(ROOT, "src", "data", "substations.json");

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

// 決定論的ハッシュ → ジッター
function djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = Math.imul(h, 33) ^ s.charCodeAt(i);
  return h >>> 0;
}
function jitter(seed, scale = 0.025) {
  const h = djb2(seed);
  const dlat = ((h & 0xFFFF) / 0xFFFF - 0.5) * 2 * scale;
  const dlng = (((h >>> 16) & 0xFFFF) / 0xFFFF - 0.5) * 2 * scale;
  return { dlat, dlng };
}

function parsePrefMuni(address) {
  if (!address || typeof address !== "string") return null;
  const pm = address.match(/^(.+?[都道府県])/);
  if (!pm) return null;
  const pref = pm[1];
  const rest = address.slice(pref.length);
  const mm = rest.match(/^(?:[^市区町村]*郡)?([^市区町村]*[市区町村]+)/);
  if (!mm) return null;
  return { pref, muni: mm[1] };
}

function getOperationYear(row) {
  const rep = String(row[12] ?? "").trim();
  if (rep && rep !== "-") { const m = rep.match(/(\d{4})年/); if (m) return +m[1]; }
  const p = row[11];
  if (p && p !== "-" && !isNaN(p)) return new Date((+p - 25569) * 86400 * 1000).getFullYear();
  return null;
}

// Haversine 距離 (km)
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 設備区分の短縮ラベル
function shortType(type) {
  if (type.includes("太陽光")) return "太陽光";
  if (type.includes("風力")) return "風力";
  if (type.includes("バイオマス")) return "バイオマス";
  if (type.includes("水力")) return "水力";
  if (type.includes("地熱")) return "地熱";
  return type || "その他";
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const muniData = JSON.parse(fs.readFileSync(MUNI_JSON, "utf-8"));
  const substations = JSON.parse(fs.readFileSync(SUBS_JSON, "utf-8"));
  // 市区町村 → 重心座標のマップ
  const coordMap = {};
  for (const [pref, munis] of Object.entries(muniData)) {
    coordMap[pref] = {};
    for (const m of munis) {
      coordMap[pref][m.municipality] = m.coordinates;
    }
  }

  let grandTotal = 0;

  for (const [prefName, filename] of Object.entries(XLSX_FILES)) {
    const filePath = path.join(DATA_DIR, filename);
    const wb = XLSX.readFile(filePath, { cellText: false, cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    const sites = [];
    let skipped = 0;

    for (let i = 2; i < rows.length; i++) {
      const row = rows[i];
      const yr = getOperationYear(row);
      if (!yr || yr > 2024) { skipped++; continue; }

      const id = String(row[0] ?? "").trim();
      const opName = String(row[1] ?? "").trim();
      const repName = String(row[2] ?? "").trim();
      const opAddr = String(row[3] ?? "").trim();
      const opTel = String(row[4] ?? "").trim();
      const rawType = String(row[5] ?? "").trim();
      const kwRaw = String(row[6] ?? "").replace(/,/g, "");
      const address = String(row[7] ?? "").trim();
      if (!address) continue;

      const kw = parseFloat(kwRaw) || 0;
      const parsed = parsePrefMuni(address);
      if (!parsed) continue;
      const muni = parsed.muni;

      const centroid = coordMap[prefName]?.[muni];
      if (!centroid) continue;

      // 決定論的ジッター（設備IDまたはループインデックスで一意化）
      const seed = id || `${prefName}-${muni}-${i}`;
      const { dlat, dlng } = jitter(seed);

      const voltClass = kw >= 2000 ? "特別高圧" : kw >= 50 ? "高圧" : "低圧";

      const siteLat = Math.round((centroid.lat + dlat) * 10000) / 10000;
      const siteLng = Math.round((centroid.lng + dlng) * 10000) / 10000;
      let minDist = Infinity;
      for (const sub of substations) {
        const d = haversineKm(siteLat, siteLng, sub.coordinates.lat, sub.coordinates.lng);
        if (d < minDist) minDist = d;
      }
      const nearestSubKm = Math.round(minDist * 10) / 10;

      sites.push({
        id: id || `${prefName}-${i}`,
        t: shortType(rawType),   // 設備種別
        k: Math.round(kw),       // kW
        v: voltClass,            // 電圧クラス
        y: yr,                   // 運転開始年
        la: siteLat,
        lg: siteLng,
        d: nearestSubKm,           // 最寄変電所距離 (km)
        m: muni,
        a: address,              // 発電設備の所在地（代表住所）
        op: opName,              // 発電事業者名
        rp: repName,             // 代表者名
        oa: opAddr,              // 事業者住所
        tel: opTel,              // 事業者電話番号
      });
    }

    const outPath = path.join(OUT_DIR, `${prefName}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sites), "utf-8");
    grandTotal += sites.length;
    console.log(`[gen] ${prefName}: ${sites.length}件 (${skipped}件除外) → ${path.basename(outPath)}`);
  }

  console.log(`[gen] 完了: 合計 ${grandTotal}件`);
}

main().catch(e => { console.error(e); process.exit(1); });
