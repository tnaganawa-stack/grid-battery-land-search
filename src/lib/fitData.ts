/**
 * FIT認定情報ポータルデータ読み込み
 * src/data/fit_municipalities.json（事前処理済み静的データ）から直接読み込む
 * ランタイムでの外部API呼び出し不要・即時返却
 */

import * as path from "path";
import * as fs from "fs";

// ============================================================
// 対象都道府県（フィルタUI・マップレイヤー用）
// ============================================================
export const FIT_PREFECTURES: Record<string, string> = {
  茨城県: "08.茨城県_202603.xlsx",
  栃木県: "09.栃木県_202603.xlsx",
  群馬県: "10.群馬県_202603.xlsx",
  埼玉県: "11.埼玉県_202603.xlsx",
  千葉県: "12.千葉県_202603.xlsx",
  東京都: "13.東京都_202603.xlsx",
  神奈川県: "14.神奈川県_202603.xlsx",
  山梨県: "19.山梨県_202603.xlsx",
  長野県: "20.長野県_202603.xlsx",
  静岡県: "22.静岡県_202603.xlsx",
};

// ============================================================
// 型定義
// ============================================================
export interface FitMunicipalityData {
  prefecture: string;
  municipality: string;
  coordinates: { lat: number; lng: number };
  siteCount: number;
  totalCapacityKw: number;
  facilityTypes: string[];
  capacityKwByClass?: { 低圧: number; 高圧: number; 特別高圧: number };
}

// ============================================================
// 静的JSONデータ読み込み（サーバー起動時1回のみ）
// ============================================================
let _allData: Record<string, FitMunicipalityData[]> | null = null;

function loadStaticData(): Record<string, FitMunicipalityData[]> {
  if (_allData) return _allData;

  const jsonPath = path.join(process.cwd(), "src", "data", "fit_municipalities.json");
  if (!fs.existsSync(jsonPath)) {
    console.warn("[fitData] fit_municipalities.json が見つかりません:", jsonPath);
    return {};
  }

  try {
    const raw = fs.readFileSync(jsonPath, "utf-8");
    _allData = JSON.parse(raw) as Record<string, FitMunicipalityData[]>;
    const total = Object.values(_allData).reduce((s, arr) => s + arr.length, 0);
    console.log(`[fitData] 静的データ読み込み完了: ${total}市区町村`);
    return _allData;
  } catch (e) {
    console.error("[fitData] JSON読み込みエラー:", e);
    return {};
  }
}

// ============================================================
// 都道府県別データ取得（同期的・キャッシュ不要）
// ============================================================
export async function getFitSitesForPrefecture(
  prefName: string
): Promise<FitMunicipalityData[]> {
  const data = loadStaticData();
  const result = data[prefName] ?? [];
  if (result.length === 0) {
    console.warn(`[fitData] ${prefName}: データなし（fit_municipalities.json に未収録）`);
  }
  return result;
}
