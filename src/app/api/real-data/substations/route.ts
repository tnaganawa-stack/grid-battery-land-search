/**
 * GET /api/real-data/substations
 * OpenStreetMap Overpass API から関東+山梨+長野の154kV以上変電所を返す
 * サーバー側で1時間キャッシュ
 */

import { NextResponse } from "next/server";
import { getSubstations } from "@/lib/osmData";
import { MOCK_SUBSTATIONS } from "@/lib/mockData";

export async function GET() {
  try {
    const substations = await getSubstations();
    if (substations.length === 0) {
      // OSMにデータがなければモックにフォールバック
      return NextResponse.json(MOCK_SUBSTATIONS, {
        headers: { "X-Data-Source": "mock-fallback" },
      });
    }
    return NextResponse.json(substations, {
      headers: { "X-Data-Source": "osm" },
    });
  } catch (e) {
    console.error("[/api/real-data/substations]", e);
    // エラー時はモックデータを返す
    return NextResponse.json(MOCK_SUBSTATIONS, {
      headers: { "X-Data-Source": "mock-fallback" },
    });
  }
}
