"""
中部地方のウェルカムゾーンマップPDFから順潮流空き容量を抽出し
grid_capacity_demand.json に追加する。

PDFの色 → 順潮流容量範囲の対応:
  黄色   (#EFC463) : 31〜100MW
  水色   (#A0CBE8) : 101〜200MW
  薄緑   (#8CD17D) : 201〜300MW
  濃緑   (#59A34F) : 301〜1,000MW
  ダーク  (#4E79A7) : 1,001MW〜
"""

import json
import sys
import io
import os
import fitz  # PyMuPDF

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_PATH = os.path.join(BASE_DIR, "data", "中部", "中部地方のウェルカムゾーンマップ  (1).pdf")
LINES_PATH = os.path.join(BASE_DIR, "src", "data", "transmission_lines_chubu.json")
DEMAND_PATH = os.path.join(BASE_DIR, "src", "data", "grid_capacity_demand.json")

# PDF地図エリア (fitz座標, 左上原点)
MAP_X0, MAP_Y0 = 40.0, 75.0   # 地図左上
MAP_X1, MAP_Y1 = 461.0, 280.0  # 地図右下

# 地図が示す地理範囲
GEO_LNG0, GEO_LNG1 = 135.8, 139.1  # 左 → 右
GEO_LAT1, GEO_LAT0 = 37.3, 33.5   # 上 → 下 (PDF y と lat は逆)

# レンダリング倍率 (ピクセル解像度)
SCALE = 4


def pdf_to_pixel(x_pdf, y_pdf):
    px = int((x_pdf - MAP_X0) * SCALE)
    py = int((y_pdf - MAP_Y0) * SCALE)
    return px, py


def geo_to_pdf(lat, lng):
    x = MAP_X0 + (lng - GEO_LNG0) / (GEO_LNG1 - GEO_LNG0) * (MAP_X1 - MAP_X0)
    y = MAP_Y0 + (GEO_LAT1 - lat) / (GEO_LAT1 - GEO_LAT0) * (MAP_Y1 - MAP_Y0)
    return x, y


def classify_color(r, g, b):
    """RGB値から順潮流容量範囲を返す。地形色(暗い緑)と区別するため高めの閾値を使用。"""
    # 黄色 (#EFC463): R=241,G=206,B=99 - 地形と明確に区別できる
    if r > 190 and g > 160 and b < 140 and r > g * 0.9:
        return "31~100MW"
    # 水色 (#A0CBE8): R=160,G=203,B=232 - B が高い
    if b > 190 and g > 175 and r > 120 and r < 210 and b > g:
        return "101~200MW"
    # 薄緑 (#8CD17D): R=140,G=209,B=125 - G が非常に高い
    if g > 185 and r > 100 and r < 190 and b > 90 and b < 165 and g > r and g > b:
        return "201~300MW"
    # 濃緑 (#59A34F): R=89,G=161,B=79 - G > 140 で地形(G<120)と区別
    if g > 140 and g < 180 and r < 115 and b < 100:
        return "301~1000MW"
    # スチールブルー (#4E79A7): R=78,G=121,B=167 - B が高い
    if b > 140 and b > g and b > r * 1.5 and g > 90 and g < 155:
        return "1001MW~"
    return None


def sample_area(pix, cx, cy, radius, img_w, img_h):
    """中心点(cx,cy)周辺のradius×radiusをスキャンして分類結果を返す。"""
    votes = {}
    for dx in range(-radius, radius + 1):
        for dy in range(-radius, radius + 1):
            px, py = cx + dx, cy + dy
            if px < 0 or py < 0 or px >= img_w or py >= img_h:
                continue
            pixel = pix.pixel(px, py)
            r, g, b = pixel[0], pixel[1], pixel[2]
            cap = classify_color(r, g, b)
            if cap:
                votes[cap] = votes.get(cap, 0) + 1
    return votes


def main():
    # PDF をラスタライズ
    print("PDFをレンダリング中...")
    doc = fitz.open(PDF_PATH)
    page = doc[0]
    clip = fitz.Rect(MAP_X0, MAP_Y0, MAP_X1, MAP_Y1)
    mat = fitz.Matrix(SCALE, SCALE)
    pix = page.get_pixmap(matrix=mat, clip=clip)
    img_w, img_h = pix.width, pix.height
    print(f"  画像サイズ: {img_w} x {img_h}")

    # 送電線データ読み込み
    with open(LINES_PATH, encoding="utf-8") as f:
        lines = json.load(f)
    print(f"  送電線数: {len(lines)}")

    results = []
    no_match = 0
    color_dist = {}
    seen_names = set()

    for line in lines:
        name = line.get("name", "")
        kv = line.get("voltageKv", 0)
        path = line.get("path", [])
        if not path or not name or name in seen_names:
            continue
        seen_names.add(name)

        # ライン全体から均等間隔でサンプリング（最大20点）
        n_pts = len(path)
        step = max(1, n_pts // 20)
        sample_idxs = list(range(0, n_pts, step)) + [n_pts - 1]
        capacity_votes = {}

        for idx in sample_idxs:
            pt = path[idx]
            lat, lng = pt["lat"], pt["lng"]

            x_pdf, y_pdf = geo_to_pdf(lat, lng)
            cx = int((x_pdf - MAP_X0) * SCALE)
            cy = int((y_pdf - MAP_Y0) * SCALE)

            if cx < 0 or cy < 0 or cx >= img_w or cy >= img_h:
                continue

            # 中心点周辺5×5をスキャン
            area_votes = sample_area(pix, cx, cy, 5, img_w, img_h)
            for cap, cnt in area_votes.items():
                capacity_votes[cap] = capacity_votes.get(cap, 0) + cnt

        if capacity_votes:
            best_cap = max(capacity_votes, key=capacity_votes.get)
            color_dist[best_cap] = color_dist.get(best_cap, 0) + 1
            results.append({
                "no": len(results) + 1,
                "name": name,
                "voltageKv": kv,
                "demandMw": best_cap,
            })
        else:
            no_match += 1

    print(f"\n結果: {len(results)} 件 (マッチなし: {no_match} 件)")
    print("容量分布:", color_dist)

    # grid_capacity_demand.json を更新
    with open(DEMAND_PATH, encoding="utf-8") as f:
        demand_all = json.load(f)

    # 既存の中部データを削除
    demand_all = [ds for ds in demand_all if ds.get("area") != "中部電力（77kV〜500kV）"]

    demand_all.append({
        "source": "中部電力パワーグリッド株式会社 中部地方のウェルカムゾーンマップ",
        "date": "2026-05-01",
        "area": "中部電力（77kV〜500kV）",
        "lines": results,
    })

    with open(DEMAND_PATH, "w", encoding="utf-8") as f:
        json.dump(demand_all, f, ensure_ascii=False, indent=2)

    print(f"\ngrid_capacity_demand.json 更新完了 (エリア数: {len(demand_all)})")


if __name__ == "__main__":
    main()
