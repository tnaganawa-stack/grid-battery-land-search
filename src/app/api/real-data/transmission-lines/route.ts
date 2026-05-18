/**
 * GET /api/real-data/transmission-lines
 * 関東全域154kV+ + 県別66kV/77kV + 東北7県 + 中部 + 関西7府県 をマージして即時返却
 */

import { NextResponse } from "next/server";
import { MOCK_TRANSMISSION_LINES } from "@/lib/mockData";
import * as fs from "fs";
import * as path from "path";
import type { TransmissionLine } from "@/types";

const DATA_DIR = path.join(process.cwd(), "src", "data");

const KANTO_LINES_PATH = path.join(DATA_DIR, "transmission_lines_kanto.json");

// 県別66kV/77kV静的JSONファイル（群馬は全電圧、他は<154kVのみ使用）
const PREF_66KV_FILES = [
  "transmission_lines_gunma.json",
  "transmission_lines_66kv_kanto.json",
  "transmission_lines_66kv_chiba.json",
  "transmission_lines_66kv_saitama.json",
  "transmission_lines_66kv_yamanashi.json",
  "transmission_lines_66kv_tochigi.json",
  "transmission_lines_66kv_kanagawa.json",
  "transmission_lines_66kv_ibaraki.json",
  "transmission_lines_66kv_nagano.json",
  "transmission_lines_66kv_shizuoka.json",
].map(f => path.join(DATA_DIR, f));

// 中部電力（77kV〜500kV）
const CHUBU_FILES = [
  "transmission_lines_chubu.json",
].map(f => path.join(DATA_DIR, f));

// 関西電力（66kV〜500kV、7府県）
const KANSAI_FILES = [
  "transmission_lines_kansai_fukui.json",
  "transmission_lines_kansai_shiga.json",
  "transmission_lines_kansai_kyoto.json",
  "transmission_lines_kansai_osaka.json",
  "transmission_lines_kansai_hyogo.json",
  "transmission_lines_kansai_nara.json",
  "transmission_lines_kansai_wakayama.json",
].map(f => path.join(DATA_DIR, f));

// 東北7県（全電圧 66kV〜275kV を含む）
const TOHOKU_FILES = [
  "transmission_lines_tohoku_aomori.json",
  "transmission_lines_tohoku_iwate.json",
  "transmission_lines_tohoku_miyagi.json",
  "transmission_lines_tohoku_akita.json",
  "transmission_lines_tohoku_yamagata.json",
  "transmission_lines_tohoku_fukushima.json",
  "transmission_lines_tohoku_niigata.json",
].map(f => path.join(DATA_DIR, f));

function loadJson(filePath: string): TransmissionLine[] {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as TransmissionLine[];
  } catch {
    return [];
  }
}

// モジュールレベルでキャッシュ（プロセス再起動まで保持）
let _cached: TransmissionLine[] | null = null;

function buildMerged(): TransmissionLine[] {
  if (_cached) return _cached;

  // 154kV+ 全関東
  const kantoLines = loadJson(KANTO_LINES_PATH);

  // 県別66kV/77kVファイル (<154kVのみ採用してkantoLinesとの重複を防ぐ)
  const seen = new Set<string>(kantoLines.map(l => l.id));
  const pref66Lines: TransmissionLine[] = [];
  for (const filePath of PREF_66KV_FILES) {
    const lines = loadJson(filePath).filter(l => l.voltageKv < 154);
    for (const line of lines) {
      if (!seen.has(line.id)) {
        seen.add(line.id);
        pref66Lines.push(line);
      }
    }
  }

  // 東北7県（全電圧）
  const tohokuLines: TransmissionLine[] = [];
  for (const filePath of TOHOKU_FILES) {
    for (const line of loadJson(filePath)) {
      if (!seen.has(line.id)) {
        seen.add(line.id);
        tohokuLines.push(line);
      }
    }
  }

  // 中部電力（77kV〜500kV）
  const chubuLines: TransmissionLine[] = [];
  for (const filePath of CHUBU_FILES) {
    for (const line of loadJson(filePath)) {
      if (!seen.has(line.id)) {
        seen.add(line.id);
        chubuLines.push(line);
      }
    }
  }

  // 関西電力（66kV〜500kV）
  const kansaiLines: TransmissionLine[] = [];
  for (const filePath of KANSAI_FILES) {
    for (const line of loadJson(filePath)) {
      if (!seen.has(line.id)) {
        seen.add(line.id);
        kansaiLines.push(line);
      }
    }
  }

  const merged = [...kantoLines, ...pref66Lines, ...tohokuLines, ...chubuLines, ...kansaiLines];
  _cached = merged;
  console.log(`[transmission-lines] merged: ${merged.length} lines (154kV+=${kantoLines.length}, 66/77kV=${pref66Lines.length}, 東北=${tohokuLines.length}, 中部=${chubuLines.length}, 関西=${kansaiLines.length})`);
  return merged;
}

export async function GET() {
  const merged = buildMerged();

  if (merged.length === 0) {
    return NextResponse.json(MOCK_TRANSMISSION_LINES, {
      headers: { "X-Data-Source": "mock-fallback" },
    });
  }
  return NextResponse.json(merged, {
    headers: {
      "X-Data-Source": "static",
      "Cache-Control": "no-store",
    },
  });
}
