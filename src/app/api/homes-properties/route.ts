import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import type { HomesProperty } from '@/components/PropertyListModal'

function rowToProperty(row: Record<string, unknown>): HomesProperty {
  return {
    id: row.id as string,
    address: row.address as string,
    priceMen: row.price_men as number | null,
    areaSqm: row.area_sqm as number | null,
    lat: row.lat as number,
    lng: row.lng as number,
    nearestLineName: (row.nearest_line_name as string) ?? '',
    nearestLineKv: (row.nearest_line_kv as number) ?? 0,
    nearestDistM: (row.nearest_dist_m as number) ?? 0,
    nearestCapMw: row.nearest_cap_mw as number | null,
    nearestSubName: (row.nearest_sub_name as string) ?? '',
    nearestSubDistM: (row.nearest_sub_dist_m as number) ?? 0,
    nearestSubKv: (row.nearest_sub_kv as number) ?? 0,
    nearestSubCapMw: row.nearest_sub_cap_mw as number | null,
    status: (row.status as HomesProperty['status']) ?? '未着手',
    comment: (row.comment as string) ?? '',
  }
}

// status/comment カラムがなければ追加（冪等）
let _migrated = false
async function ensureMigrated() {
  if (_migrated) return
  try {
    const sql = getDb()
    await sql`ALTER TABLE homes_properties ADD COLUMN IF NOT EXISTS status TEXT DEFAULT '未着手'`
    await sql`ALTER TABLE homes_properties ADD COLUMN IF NOT EXISTS comment TEXT DEFAULT ''`
    _migrated = true
  } catch (e) {
    console.error('[homes-properties migrate]', e)
  }
}

export async function GET() {
  try {
    await ensureMigrated()
    const sql = getDb()
    const rows = await sql`SELECT * FROM homes_properties ORDER BY created_at DESC`
    return NextResponse.json(rows.map(rowToProperty))
  } catch (e) {
    console.error('[homes-properties GET]', e)
    return NextResponse.json([], { status: 200 })
  }
}

export async function POST(request: Request) {
  try {
    await ensureMigrated()
    const body: HomesProperty = await request.json()
    const sql = getDb()
    await sql`
      INSERT INTO homes_properties
        (id, address, price_men, area_sqm, lat, lng, nearest_line_name, nearest_line_kv, nearest_dist_m, nearest_cap_mw,
         nearest_sub_name, nearest_sub_dist_m, nearest_sub_kv, nearest_sub_cap_mw, status, comment)
      VALUES
        (${body.id}, ${body.address}, ${body.priceMen ?? null}, ${body.areaSqm ?? null},
         ${body.lat}, ${body.lng}, ${body.nearestLineName ?? ''}, ${body.nearestLineKv ?? 0},
         ${body.nearestDistM ?? 0}, ${body.nearestCapMw ?? null},
         ${body.nearestSubName ?? ''}, ${body.nearestSubDistM ?? 0}, ${body.nearestSubKv ?? 0},
         ${body.nearestSubCapMw ?? null}, ${body.status ?? '未着手'}, ${body.comment ?? ''})
      ON CONFLICT (id) DO NOTHING
    `
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[homes-properties POST]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const sql = getDb()
    // ステータス更新（status/commentフィールドが含まれる場合）
    if ('status' in body || 'comment' in body) {
      await sql`
        UPDATE homes_properties SET
          status  = ${body.status ?? '未着手'},
          comment = ${body.comment ?? ''}
        WHERE id = ${body.id}
      `
    } else {
      // 送電線・変電所距離の自動計算更新
      await sql`
        UPDATE homes_properties SET
          nearest_line_name  = ${body.nearestLineName},
          nearest_line_kv    = ${body.nearestLineKv},
          nearest_dist_m     = ${body.nearestDistM},
          nearest_cap_mw     = ${body.nearestCapMw ?? null},
          nearest_sub_name   = ${body.nearestSubName ?? ''},
          nearest_sub_dist_m = ${body.nearestSubDistM ?? 0},
          nearest_sub_kv     = ${body.nearestSubKv ?? 0},
          nearest_sub_cap_mw = ${body.nearestSubCapMw ?? null}
        WHERE id = ${body.id}
      `
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[homes-properties PATCH]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { id, all } = await request.json()
    const sql = getDb()
    if (all) {
      await sql`DELETE FROM homes_properties`
    } else {
      await sql`DELETE FROM homes_properties WHERE id = ${id}`
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[homes-properties DELETE]', e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}
