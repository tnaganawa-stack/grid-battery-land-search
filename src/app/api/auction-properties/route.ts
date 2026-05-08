import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import type { AuctionProperty } from "@/types";
import { getSubstations, haversineKm } from "@/lib/osmData";

const DATA_PATH = path.join(process.cwd(), "src", "data", "auction_properties.json");

export async function GET() {
  let properties: AuctionProperty[] = [];

  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    properties = JSON.parse(raw) as AuctionProperty[];
  } catch {
    return NextResponse.json([], { status: 200 });
  }

  // 最寄り変電所を計算して付与
  try {
    const substations = await getSubstations();
    properties = properties.map((p) => {
      let bestSub = substations[0];
      let bestDist = Infinity;
      for (const s of substations) {
        const d = haversineKm(p.coordinates.lat, p.coordinates.lng, s.coordinates.lat, s.coordinates.lng);
        if (d < bestDist) { bestSub = s; bestDist = d; }
      }
      return {
        ...p,
        nearestSubstation: {
          name: bestSub.name,
          distance: Math.round(bestDist * 10) / 10,
          voltageKv: bestSub.voltageKv,
        },
      };
    });
  } catch {
    // 変電所取得失敗時はそのまま返す
  }

  return NextResponse.json(properties, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
