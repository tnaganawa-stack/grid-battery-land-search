/**
 * GET /api/real-data/fit-individual
 * クエリパラメータでフィルタリングして個別FIT設備を返す
 *
 * ?prefecture=茨城県          (必須)
 * &kwMin=500                  (任意, デフォルト0)
 * &kwMax=99999                (任意)
 * &types=太陽光,風力          (任意, カンマ区切り)
 * &voltageClass=高圧,特別高圧 (任意, カンマ区切り)
 * &yrMin=2010&yrMax=2024      (任意)
 */
import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export interface IndividualFitSite {
  id: string;
  t: string;    // 設備種別
  k: number;    // kW
  v: string;    // 電圧クラス
  y: number;    // 運転開始年
  la: number;   // lat
  lg: number;   // lng
  m: string;    // 市区町村
  d?: number;   // 最寄変電所距離 (km)
}

const DATA_DIR = path.join(process.cwd(), "src", "data", "fit_individual");

// 都道府県ごとのインメモリキャッシュ
const prefCache: Map<string, IndividualFitSite[]> = new Map();

function loadPref(pref: string): IndividualFitSite[] {
  if (prefCache.has(pref)) return prefCache.get(pref)!;
  const filePath = path.join(DATA_DIR, `${pref}.json`);
  if (!fs.existsSync(filePath)) return [];
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as IndividualFitSite[];
  prefCache.set(pref, data);
  return data;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const pref = searchParams.get("prefecture");
  if (!pref) {
    return NextResponse.json({ error: "prefecture is required" }, { status: 400 });
  }

  const kwMin = parseInt(searchParams.get("kwMin") ?? "0") || 0;
  const kwMax = parseInt(searchParams.get("kwMax") ?? "999999") || 999999;
  const typesRaw = searchParams.get("types");
  const types = typesRaw ? typesRaw.split(",").map(s => s.trim()) : [];
  const vcRaw = searchParams.get("voltageClass");
  const voltageClasses = vcRaw ? vcRaw.split(",").map(s => s.trim()) : [];
  const yrMin = parseInt(searchParams.get("yrMin") ?? "0") || 0;
  const yrMax = parseInt(searchParams.get("yrMax") ?? "9999") || 9999;
  const maxDistKm = parseFloat(searchParams.get("maxDistKm") ?? "0") || 0;

  let data = loadPref(pref);

  if (kwMin > 0)              data = data.filter(s => s.k >= kwMin);
  if (kwMax < 999999)         data = data.filter(s => s.k <= kwMax);
  if (types.length > 0)       data = data.filter(s => types.includes(s.t));
  if (voltageClasses.length > 0) data = data.filter(s => voltageClasses.includes(s.v));
  if (yrMin > 0)              data = data.filter(s => s.y >= yrMin);
  if (yrMax < 9999)           data = data.filter(s => s.y <= yrMax);
  if (maxDistKm > 0)          data = data.filter(s => (s.d ?? 999) <= maxDistKm);

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "X-Total-Count": String(data.length),
    },
  });
}
