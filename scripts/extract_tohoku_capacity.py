"""
東北各県の送電線予想潮流PDFから空き容量データを抽出する。
pdfplumber でテーブル・テキストを読み込み、送電線名と空容量(MW)を取得する。

使い方: python scripts/extract_tohoku_capacity.py
"""

import pdfplumber
import json
import re
import os
import sys

# stdout を UTF-8 に固定
sys.stdout.reconfigure(encoding='utf-8')

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', '東北')

PREFECTURES = [
    ('宮城', '送電線予想潮流_宮城.pdf'),
    ('山形', '送電線予想潮流_山形.pdf'),
    ('岩手', '送電線予想潮流_岩手.pdf'),
    ('新潟', '送電線予想潮流_新潟.pdf'),
    ('福島', '送電線予想潮流_福島.pdf'),
    ('秋田', '送電線予想潮流_秋田.pdf'),
    ('青森', '送電線予想潮流_青森.pdf'),
]


def parse_mw(val):
    """文字列からMW数値を取得。ハイフン・空白はNone"""
    if not val:
        return None
    val = str(val).strip().replace(',', '').replace('，', '')
    if val in ('-', '－', '—', ''):
        return None
    try:
        return float(val)
    except ValueError:
        return None


def mw_to_range(mw):
    """MW数値をレンジ文字列に変換"""
    if mw is None:
        return None
    if mw <= 0:
        return "0MW"
    if mw < 50:
        return "~50MW"
    if mw < 75:
        return "50~75MW"
    if mw < 100:
        return "75~100MW"
    return "100MW~"


def extract_voltage(val):
    """電圧欄文字列からkV数値を取得"""
    if not val:
        return None
    m = re.search(r'(\d+)', str(val))
    if not m:
        return None
    v = int(m.group(1))
    # 東北電力の主な電圧: 66, 77, 154 kV
    if v in (66, 77, 154, 275, 500):
        return v
    return None


def extract_from_pdf(pref_name, pdf_path):
    """1つのPDFから送電線名・電圧・空容量を抽出してリストで返す"""
    lines = []

    if not os.path.exists(pdf_path):
        print(f"  [SKIP] ファイルなし: {pdf_path}")
        return lines

    print(f"\n[{pref_name}] {os.path.basename(pdf_path)} 処理中...")

    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages, 1):
            tables = page.extract_tables()
            if not tables:
                continue

            for table in tables:
                if not table:
                    continue

                # ヘッダー行を探す
                header_row_idx = None
                for i, row in enumerate(table):
                    row_text = ' '.join(str(c) for c in row if c)
                    if '送電線' in row_text and ('空容量' in row_text or '空き容量' in row_text or '電圧' in row_text):
                        header_row_idx = i
                        break

                if header_row_idx is None:
                    # ヘッダーなしでも処理を試みる（先頭から）
                    header_row_idx = 0

                # 列インデックスを推定
                header = table[header_row_idx] if table else []
                name_col = None
                voltage_col = None
                empty_cap_col = None  # 空容量列

                for ci, cell in enumerate(header):
                    c = str(cell or '').strip()
                    if '送電線' in c and '名' in c:
                        name_col = ci
                    elif '名称' in c and name_col is None:
                        name_col = ci
                    elif '電圧' in c or 'kV' in c:
                        voltage_col = ci
                    elif '空容量' in c or '空き容量' in c:
                        # 最初の空容量列を使う（当該設備欄）
                        if empty_cap_col is None:
                            empty_cap_col = ci

                # データ行を処理
                for row in table[header_row_idx + 1:]:
                    if not row or all(not c for c in row):
                        continue

                    # 送電線名
                    name = None
                    if name_col is not None and name_col < len(row):
                        name = str(row[name_col] or '').strip()
                    if not name:
                        # 最初の非空セルを送電線名候補として試みる
                        for cell in row:
                            c = str(cell or '').strip()
                            if c and not re.match(r'^[\d\.\-－—]+$', c):
                                name = c
                                break
                    if not name or len(name) < 2:
                        continue
                    # 「線」で終わる or 線名パターン
                    if not (name.endswith('線') or name.endswith('回線') or re.search(r'[ぁ-ん一-龯]', name)):
                        continue

                    # 電圧
                    voltage_kv = None
                    if voltage_col is not None and voltage_col < len(row):
                        voltage_kv = extract_voltage(row[voltage_col])
                    if voltage_kv is None:
                        # 行内を検索
                        for cell in row:
                            v = extract_voltage(cell)
                            if v:
                                voltage_kv = v
                                break

                    # 空容量MW
                    available_mw = None
                    if empty_cap_col is not None and empty_cap_col < len(row):
                        available_mw = parse_mw(row[empty_cap_col])
                    if available_mw is None:
                        # 最後の数値セルを試みる
                        for cell in reversed(row):
                            v = parse_mw(cell)
                            if v is not None and v >= 0:
                                available_mw = v
                                break

                    lines.append({
                        'name': name,
                        'voltageKv': voltage_kv or 66,
                        'availableMw': available_mw,
                        'demandMw': mw_to_range(available_mw),
                    })

    print(f"  → {len(lines)} 件抽出")
    return lines


def main():
    results = []

    for pref_name, pdf_filename in PREFECTURES:
        pdf_path = os.path.join(DATA_DIR, pdf_filename)
        lines = extract_from_pdf(pref_name, pdf_path)

        if lines:
            results.append({
                'area': f'{pref_name}エリア',
                'lines': [
                    {
                        'name': l['name'],
                        'voltageKv': l['voltageKv'],
                        'availableMw': l['availableMw'],
                        'demandMw': l['demandMw'],
                    }
                    for l in lines
                ]
            })

        # サンプル表示
        if lines:
            print(f"  サンプル (最初5件):")
            for l in lines[:5]:
                print(f"    {l['name']} ({l['voltageKv']}kV) 空容量={l['availableMw']}MW → {l['demandMw']}")

    # 結果を一時ファイルに保存
    out_path = 'tmp_tohoku_capacity.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\n\n=== 抽出完了 ===")
    print(f"出力: {out_path}")
    total = sum(len(ds['lines']) for ds in results)
    print(f"合計: {len(results)} エリア, {total} 送電線")


if __name__ == '__main__':
    main()
