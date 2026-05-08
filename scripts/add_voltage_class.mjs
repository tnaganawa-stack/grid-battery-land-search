/**
 * fit_municipalities.json に電圧クラス別容量データを追加
 * 低圧(<50kW) / 高圧(50~2000kW) / 特別高圧(>=2000kW)
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

function excelSerialToYear(serial) {
  if (!serial || isNaN(serial)) return null;
  return new Date((Number(serial) - 25569) * 86400 * 1000).getFullYear();
}

function getOperationYear(row) {
  const reported = String(row[12] ?? "").trim();
  if (reported && reported !== "-") {
    const m = reported.match(/(\d{4})年/);
    if (m) return parseInt(m[1]);
  }
  const planned = row[11];
  if (planned && planned !== "-" && !isNaN(planned)) return excelSerialToYear(planned);
  return null;
}

function voltageClass(kw) {
  if (kw >= 2000) return "特別高圧";
  if (kw >= 50)   return "高圧";
  return "低圧";
}

// 都道府県ごとに {muni -> {低圧:kw, 高圧:kw, 特別高圧:kw}} を集計
function buildVoltageMap(prefName, filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return new Map();
  const wb = XLSX.readFile(filePath, { sheetRows: 0, cellText: false, cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  const map = new Map();
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    const address = String(row[7] ?? "").trim();
    if (!address) continue;
    const opYear = getOperationYear(row);
    if (opYear === null || opYear > 2024) continue;

    const kw = parseFloat(String(row[6] ?? "").replace(/,/g, "")) || 0;
    const parsed = parsePrefMuni(address);
    if (!parsed) continue;
    const muni = parsed.muni;
    if (!map.has(muni)) map.set(muni, { 低圧: 0, 高圧: 0, 特別高圧: 0 });
    map.get(muni)[voltageClass(kw)] += kw;
  }
  return map;
}

async function main() {
  const raw = fs.readFileSync(OUT_PATH, "utf-8");
  const data = JSON.parse(raw);

  for (const [pref, filename] of Object.entries(XLSX_FILES)) {
    const voltageMap = buildVoltageMap(pref, filename);
    const munis = data[pref] ?? [];
    for (const m of munis) {
      const vc = voltageMap.get(m.municipality) ?? { 低圧: 0, 高圧: 0, 特別高圧: 0 };
      m.capacityKwByClass = {
        低圧: Math.round(vc["低圧"]),
        高圧: Math.round(vc["高圧"]),
        特別高圧: Math.round(vc["特別高圧"]),
      };
    }
    console.log(`[voltage] ${pref}: ${munis.length}市区町村 更新`);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 2), "utf-8");
  console.log(`[voltage] 保存完了: ${OUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
