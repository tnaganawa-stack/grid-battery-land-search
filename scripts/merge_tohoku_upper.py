"""
送電線_東北.pdf から 154kV〜500kV 上位系統の空き容量データを抽出し
grid_capacity_all.json に追加する。

空容量列はほぼ「-」のため、N-1電制適用可能量 を availableMw として使用。
これは再エネ接続可能量の近似値として最も実用的。

使い方: python scripts/merge_tohoku_upper.py
"""

import pdfplumber
import json
import re
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')

PDF_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', '東北', '送電線_東北.pdf')
CAP_ALL_PATH = 'src/data/grid_capacity_all.json'


def to_float(s):
    if not s:
        return None
    s = str(s).strip().replace(',', '').replace('，', '')
    if s in ('-', '－', '—', '', '−'):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def osm_name(name):
    """全角英字の回線記号 (Ａ，Ｂ 等) を除去して OSM 名称に近づける"""
    # 例: "下北Ａ，Ｂ線" → "下北線"
    #      "六ヶ所Ａ，Ｂ，Ｃ，Ｄ線" → "六ヶ所線"
    normalized = re.sub(r'[Ａ-Ｚ]（，[Ａ-Ｚ]）*|[Ａ-Ｚ]，[Ａ-Ｚ](，[Ａ-Ｚ])*|[Ａ-Ｚ]$', '', name)
    return normalized.strip()


def extract_lines():
    lines = []
    with pdfplumber.open(PDF_PATH) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                # 最初の2行はヘッダー（送電線No行 + 当該設備/上位系等考慮行）
                for row in table[2:]:
                    if not row or len(row) < 13:
                        continue
                    name = str(row[1] or '').strip()
                    if not name or len(name) < 2:
                        continue

                    vol_s = str(row[2] or '').strip()
                    m = re.search(r'(\d+)', vol_s)
                    if not m:
                        continue
                    kv = int(m.group(1))
                    if kv not in (66, 77, 154, 275, 500):
                        continue

                    op_cap = to_float(row[5])   # 運用容量値
                    cap9   = to_float(row[9])   # 空容量当該設備（ほぼ-）
                    n1cap  = to_float(row[12])  # N-1電制適用可能量

                    # 優先順位: 空容量 > N-1電制可能量 > None
                    avail = cap9 if cap9 is not None else n1cap

                    lines.append({
                        'pdf_name': name,
                        'osm_name': osm_name(name),
                        'voltageKv': kv,
                        'availableMw': avail,
                        'operatingCapMw': op_cap,
                    })

    return lines


def main():
    print('[送電線_東北.pdf] 抽出中...')
    raw = extract_lines()

    # 重複除去（PDF名で）
    seen = set()
    unique = []
    for l in raw:
        if l['pdf_name'] not in seen:
            seen.add(l['pdf_name'])
            unique.append(l)

    print(f'  {len(unique)} 件 抽出 (重複除去後)')
    by_v = {}
    for l in unique:
        v = l['voltageKv']
        by_v[v] = by_v.get(v, 0) + 1
    print(f'  電圧分布: {by_v}')
    has_cap = sum(1 for l in unique if l['availableMw'] is not None)
    print(f'  空き容量データあり: {has_cap} 件 / {len(unique)} 件')

    # grid_capacity_all.json を読み込む
    with open(CAP_ALL_PATH, encoding='utf-8') as f:
        existing = json.load(f)

    # 既存の東北上位系統を除去（再実行防止）
    existing = [ds for ds in existing if ds.get('area') != '東北上位系統（154kV〜500kV）']

    # JSON行エントリを生成（OSM名称を name に使用）
    entries = []
    no = 1
    for l in unique:
        name_for_lookup = l['osm_name'] if l['osm_name'] != l['pdf_name'] else l['pdf_name']
        entries.append({
            'no': no,
            'name': name_for_lookup,
            'voltageKv': l['voltageKv'],
            'availableMw': l['availableMw'],
            'n1AvailableMw': None,
        })
        no += 1

    new_dataset = {
        'source': '東北電力ネットワーク株式会社 送電線予想潮流（東北全域）',
        'date': '2026-05-08',
        'area': '東北上位系統（154kV〜500kV）',
        'lines': entries,
    }

    merged = existing + [new_dataset]
    with open(CAP_ALL_PATH, 'w', encoding='utf-8') as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

    print(f'\n=== 統合完了 ===')
    print(f'エリア数: {len(merged)}')
    print(f'東北上位系統: {len(entries)} 件追加')

    # サンプル表示
    print('\n空き容量データのサンプル:')
    for l in [x for x in unique if x['availableMw'] is not None][:10]:
        print(f'  {l["pdf_name"]} ({l["voltageKv"]}kV) → OSM:{l["osm_name"]} 空容量={l["availableMw"]:.0f}MW')

    # 分布
    avails = [l['availableMw'] for l in unique if l['availableMw'] is not None]
    if avails:
        z  = sum(1 for v in avails if v == 0)
        lt50 = sum(1 for v in avails if 0 < v < 50)
        lt200 = sum(1 for v in avails if 50 <= v < 200)
        over = sum(1 for v in avails if v >= 200)
        print(f'\n容量分布: 0MW={z}, ~50={lt50}, 50~200={lt200}, 200+={over}')


if __name__ == '__main__':
    main()
