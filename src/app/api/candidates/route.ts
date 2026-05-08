/**
 * GET /api/candidates?source=fit|osm|all
 * source=fit  → FIT候補地のみ（高速・静的JSON）
 * source=osm  → OSM候補地のみ（低速・外部API）
 * source=all  → 両方（後方互換）
 */
import { NextResponse } from "next/server";
import type { CandidateSite } from "@/types";
import { getCandidateSites } from "@/lib/candidateData";
import { getFitCandidateSites } from "@/lib/fitCandidateData";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const source = searchParams.get("source") ?? "all";

  let osmSites: CandidateSite[] = [];
  let fitSites: CandidateSite[] = [];

  if (source === "fit" || source === "all") {
    fitSites = await getFitCandidateSites().catch((e) => {
      console.warn("[/api/candidates] FIT取得失敗:", e instanceof Error ? e.message : e);
      return [] as CandidateSite[];
    });
  }

  if (source === "osm" || source === "all") {
    osmSites = await getCandidateSites().catch((e) => {
      console.warn("[/api/candidates] OSM取得失敗:", e instanceof Error ? e.message : e);
      return [] as CandidateSite[];
    });
  }

  const all = [...osmSites, ...fitSites];
  console.log(`[/api/candidates?source=${source}] OSM ${osmSites.length}件 + FIT ${fitSites.length}件 = ${all.length}件`);

  if (all.length === 0 && source === "all") {
    console.warn("[/api/candidates] 全データ取得失敗 → モックデータにフォールバック");
    const { MOCK_CANDIDATE_SITES } = await import("@/lib/mockData");
    return NextResponse.json(MOCK_CANDIDATE_SITES, {
      headers: { "Cache-Control": "no-store", "X-Data-Source": "mock-fallback" },
    });
  }

  return NextResponse.json(all, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "X-Data-Source": source === "all" ? "real" : source,
    },
  });
}
