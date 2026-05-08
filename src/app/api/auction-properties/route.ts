import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSubstations, haversineKm } from "@/lib/osmData";
import type { AuctionProperty } from "@/types";

function rowToProperty(row: Record<string, unknown>): AuctionProperty {
  return {
    id: row.id as string,
    saleNumber: row.sale_number as string,
    name: row.name as string,
    coordinates: { lat: row.lat as number, lng: row.lng as number },
    prefecture: row.prefecture as string,
    municipality: row.municipality as string,
    address: row.address as string,
    areaM2: row.area_m2 as number,
    areaHa: row.area_ha as number,
    landType: row.land_type as string,
    estimatedPrice: row.estimated_price as number,
    depositAmount: row.deposit_amount as number,
    zoningType: row.zoning_type as string,
    zoningUse: row.zoning_use as string,
    buildingCoverage: row.building_coverage as number,
    floorAreaRatio: row.floor_area_ratio as number,
    accessRoad: row.access_road as string,
    shape: row.shape as string,
    topography: row.topography as string,
    waterSupply: row.water_supply as boolean,
    sewer: row.sewer as boolean,
    gas: row.gas as boolean,
    currentUse: row.current_use as string,
    notes: row.notes as string,
    source: row.source as string,
    contact: row.contact as string,
  };
}

export async function GET() {
  try {
    const sql = getDb();
    const rows = await sql`SELECT * FROM properties ORDER BY created_at DESC`;
    let properties = rows.map(rowToProperty);

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
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("[auction-properties GET]", e);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sql = getDb();

    const id = `prop-${Date.now()}`;
    await sql`
      INSERT INTO properties (
        id, sale_number, name, lat, lng, prefecture, municipality, address,
        area_m2, area_ha, land_type, estimated_price, deposit_amount,
        zoning_type, zoning_use, building_coverage, floor_area_ratio,
        access_road, shape, topography, water_supply, sewer, gas,
        current_use, notes, source, contact
      ) VALUES (
        ${id}, ${body.saleNumber ?? ''}, ${body.name}, ${body.lat}, ${body.lng},
        ${body.prefecture ?? ''}, ${body.municipality ?? ''}, ${body.address ?? ''},
        ${body.areaM2 ?? 0}, ${body.areaHa ?? 0}, ${body.landType ?? ''},
        ${body.estimatedPrice ?? 0}, ${body.depositAmount ?? 0},
        ${body.zoningType ?? ''}, ${body.zoningUse ?? ''},
        ${body.buildingCoverage ?? 0}, ${body.floorAreaRatio ?? 0},
        ${body.accessRoad ?? ''}, ${body.shape ?? ''}, ${body.topography ?? ''},
        ${body.waterSupply ?? false}, ${body.sewer ?? false}, ${body.gas ?? false},
        ${body.currentUse ?? ''}, ${body.notes ?? ''}, ${body.source ?? ''}, ${body.contact ?? ''}
      )
    `;

    return NextResponse.json({ ok: true, id });
  } catch (e) {
    console.error("[auction-properties POST]", e);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
