"""
PDFから抽出した東北7県の容量データをクリーニングして
grid_capacity_all.json に追加する。

使い方: python scripts/merge_tohoku_capacity.py
"""

import json
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

# フィルタアウトするノイズ行名
NOISE_NAMES = {'当該設備', '送電線名', '名称', '線名', ''}

# 「0MW」は空容量ゼロ（系統逼迫）として 0 を使用
def clean_mw(v):
    """availableMw を None → None, 0 → 0, それ以外は float"""
    if v is None:
        return None
    return float(v)


def is_valid_name(name):
    """送電線名として有効かチェック"""
    if not name or len(name) < 2:
        return False
    if name in NOISE_NAMES:
        return False
    # 数字のみ / 記号のみ はスキップ
    if re.match(r'^[\d\s\.\,\-－—\(\)（）]+$', name):
        return False
    return True


def deduplicate(lines):
    """同名・同電圧の重複を除去（最初の1件を保持）"""
    seen = set()
    result = []
    for l in lines:
        key = (l['name'], l['voltageKv'])
        if key not in seen:
            seen.add(key)
            result.append(l)
    return result


def main():
    # 抽出済みデータを読み込む
    with open('tmp_tohoku_capacity.json', encoding='utf-8') as f:
        raw = json.load(f)

    # 既存 grid_capacity_all.json を読み込む
    with open('src/data/grid_capacity_all.json', encoding='utf-8') as f:
        existing = json.load(f)

    # 既存の東北エリアを除去（再実行時の重複防止）
    existing = [ds for ds in existing if '東北' not in ds.get('area', '') and
                not any(pref in ds.get('area', '') for pref in ['宮城', '山形', '岩手', '新潟', '福島', '秋田', '青森'])]

    # 東北データを整形
    tohoku_datasets = []
    total_lines = 0
    for ds in raw:
        cleaned_lines = []
        no = 1
        for l in ds['lines']:
            name = (l.get('name') or '').strip()
            if not is_valid_name(name):
                continue
            avail = clean_mw(l.get('availableMw'))
            cleaned_lines.append({
                'no': no,
                'name': name,
                'voltageKv': l.get('voltageKv') or 66,
                'availableMw': avail,
                'n1AvailableMw': None,
            })
            no += 1

        cleaned_lines = deduplicate(cleaned_lines)
        # no を振り直す
        for i, l in enumerate(cleaned_lines, 1):
            l['no'] = i

        if cleaned_lines:
            tohoku_datasets.append({
                'source': '東北電力ネットワーク株式会社 送電線予想潮流',
                'date': '2025-09-30',
                'area': ds['area'],
                'lines': cleaned_lines,
            })
            total_lines += len(cleaned_lines)
            print(f"  {ds['area']}: {len(cleaned_lines)} 件")

    # 統合して保存
    merged = existing + tohoku_datasets
    with open('src/data/grid_capacity_all.json', 'w', encoding='utf-8') as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

    print(f"\n=== 統合完了 ===")
    print(f"既存エリア: {len(existing)} → 合計: {len(merged)} エリア")
    print(f"東北追加: {len(tohoku_datasets)} エリア, {total_lines} 件")

    # 分布確認
    for ds in tohoku_datasets:
        avails = [l['availableMw'] for l in ds['lines'] if l['availableMw'] is not None]
        if avails:
            zero  = sum(1 for v in avails if v == 0)
            lt50  = sum(1 for v in avails if 0 < v < 50)
            lt200 = sum(1 for v in avails if 50 <= v < 200)
            over  = sum(1 for v in avails if v >= 200)
            null  = sum(1 for l in ds['lines'] if l['availableMw'] is None)
            print(f"  {ds['area']}: 0MW={zero}, ~50={lt50}, ~200={lt200}, 200+={over}, null={null}")


if __name__ == '__main__':
    main()
