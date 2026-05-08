"""
系統空き容量PDF一括抽出スクリプト
data/ フォルダ内の 系統空き容量_*.pdf を処理し
src/data/grid_capacity_all.json に保存する
"""
import fitz
import json
import re
import sys
import io
import glob
import os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
OUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'grid_capacity_all.json')

# 既存の群馬データ (東電PDF済) を読み込む
TEPG_PATH = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'grid_capacity_tepg.json')
with open(TEPG_PATH, encoding='utf-8') as f:
    tepg = json.load(f)

VALID_KV = {22, 66, 154, 275, 500}

def parse_mw(s: str):
    """MW値を整数に変換。'-' や文字列は None を返す"""
    s = s.strip()
    if s in ('-', '', '－', '—', '―'):
        return None
    try:
        return int(s)
    except ValueError:
        return None

def extract_page(page) -> list[dict]:
    """1ページから送電線容量データ行を抽出"""
    words = page.get_text('words')
    if not words:
        return []

    # y座標でグループ化（±4pt = 8pt単位で丸め）
    rows: dict[float, list[tuple[float, str]]] = {}
    for w in words:
        x0, y0, x1, y1, text = w[0], w[1], w[2], w[3], w[4]
        text = text.strip()
        if not text:
            continue
        y_key = round(y0 / 8) * 8
        rows.setdefault(y_key, []).append((x0, text))

    # 各行をx順にソート
    sorted_rows = {y: sorted(cells, key=lambda c: c[0]) for y, cells in rows.items()}

    results = []
    for y, cells in sorted(sorted_rows.items()):
        x_vals = {x: v for x, v in cells}

        # No列 (x≈134) に整数があるか確認
        no_val = None
        for x, v in cells:
            if 125 <= x <= 145:
                try:
                    no_val = int(v)
                    break
                except ValueError:
                    pass
        if no_val is None:
            continue

        # 電圧列 (x≈266) に有効kV値があるか確認
        kv_val = None
        for x, v in cells:
            if 255 <= x <= 285:
                try:
                    kv = int(v)
                    if kv in VALID_KV:
                        kv_val = kv
                        break
                except ValueError:
                    pass
        if kv_val is None:
            continue

        # 送電線名 (x≈147~265)
        name_parts = [v for x, v in cells if 145 <= x <= 263]
        name = ''.join(name_parts)

        # 当該設備空容量 (x≈410~445) → availableMw
        avail_mw = None
        for x, v in cells:
            if 408 <= x <= 445:
                avail_mw = parse_mw(v)
                break

        # 適用可能量 (x≈515~545) → n1AvailableMw
        n1_mw = None
        for x, v in cells:
            if 513 <= x <= 545:
                n1_mw = parse_mw(v)
                break

        results.append({
            'no': no_val,
            'name': name,
            'voltageKv': kv_val,
            'availableMw': avail_mw,
            'n1AvailableMw': n1_mw,
        })

    return results


def extract_pdf(pdf_path: str) -> dict:
    """PDFファイル全ページから容量データを抽出"""
    doc = fitz.open(pdf_path)
    basename = os.path.basename(pdf_path)
    # ファイル名から都道府県を抽出
    m = re.search(r'系統空き容量_(.+?)\.pdf', basename)
    pref = m.group(1) if m else basename

    all_lines = []
    for pn in range(len(doc)):
        page_lines = extract_page(doc[pn])
        all_lines.extend(page_lines)

    # 重複 (No+voltage+name) を除去
    seen = set()
    unique_lines = []
    for l in all_lines:
        key = (l['no'], l['voltageKv'], l['name'])
        if key not in seen:
            seen.add(key)
            unique_lines.append(l)

    print(f'  {pref}: {len(unique_lines)} lines ({len(doc)} pages)')
    return {
        'source': 'TEPG系統空き容量マッピング',
        'date': '2026/04/19',
        'area': pref,
        'lines': unique_lines,
    }


# --- メイン処理 ---
pdfs = sorted(glob.glob(os.path.join(DATA_DIR, '系統空き容量_*.pdf')))
print(f'Found {len(pdfs)} PDFs:')
for p in pdfs:
    print(f'  {os.path.basename(p)}')
print()

all_datasets = []

# 既存の東電群馬データを先頭に追加
all_datasets.append(tepg)
print(f'  群馬（東電既存）: {len(tepg["lines"])} lines')

for pdf_path in pdfs:
    dataset = extract_pdf(pdf_path)
    if dataset['lines']:
        all_datasets.append(dataset)

print(f'\nTotal datasets: {len(all_datasets)}')
total_lines = sum(len(d['lines']) for d in all_datasets)
print(f'Total lines: {total_lines}')

with open(OUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(all_datasets, f, ensure_ascii=False, indent=2)

print(f'\nSaved to: {OUT_PATH}')
