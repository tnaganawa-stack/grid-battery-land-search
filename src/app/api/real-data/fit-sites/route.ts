/**
 * GET /api/real-data/fit-sites?prefecture=茨城県
 * FITポータルから指定都道府県のデータを取得し市区町村集計で返す
 */

import { NextRequest, NextResponse } from "next/server";
import { getFitSitesForPrefecture, FIT_PREFECTURES } from "@/lib/fitData";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const prefecture = searchParams.get("prefecture");

  if (!prefecture) {
    return NextResponse.json(
      { error: "prefecture パラメータが必要です", available: Object.keys(FIT_PREFECTURES) },
      { status: 400 }
    );
  }

  if (!FIT_PREFECTURES[prefecture]) {
    return NextResponse.json(
      { error: `対象外の都道府県: ${prefecture}`, available: Object.keys(FIT_PREFECTURES) },
      { status: 400 }
    );
  }

  try {
    const data = await getFitSitesForPrefecture(prefecture);
    return NextResponse.json(data, {
      headers: {
        "X-Site-Count": String(data.reduce((s, d) => s + d.siteCount, 0)),
        "X-Municipality-Count": String(data.length),
      },
    });
  } catch (e) {
    console.error(`[fit-sites] ${prefecture}:`, e);
    return NextResponse.json(
      { error: `取得失敗: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  }
}
