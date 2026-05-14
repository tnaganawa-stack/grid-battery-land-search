"""
送電線_東北.pdf から 154kV/275kV/500kV 上位系統の空き容量データを抽出する。

使い方: python scripts/extract_tohoku_upper.py
"""

import pdfplumber
import json
import re
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')

PDF_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', '東北', '送電線_東北.pdf')


def parse_mw(val):
    if not val:
        return None
    s = str(val).strip().replace(',', '').replace('，', '').replace(' ', '')
    # ハイフン・マイナス・空白はNone
    if s in ('-', '－', '—', '', '−', '－'):
        return None
    # 負値（逆潮流）は空き容量なし→ 0 扱い
    try:
        v = float(s)
        return max(0.0, v)
    except ValueError:
        return None


def mw_to_range(mw):
    if mw is None:
        return None
    if mw == 0:
        return "0MW"
    if mw < 50:
        return "~50MW"
    if mw < 75:
        return "50~75MW"
    if mw < 100:
        return "75~100MW"
    return "100MW~"


def main():
    if not os.path.exists(PDF_PATH):
        print(f'[ERROR] ファイルが見つかりません: {PDF_PATH}')
        return

    print(f'[送電線_東北.pdf] 読み込み中...')
    results = []

    with pdfplumber.open(PDF_PATH) as pdf:
        print(f'  総ページ数: {len(pdf.pages)}')

        for page_num, page in enumerate(pdf.pages, 1):
            print(f'\n--- ページ {page_num} ---')

            # テキスト全体を確認
            text = page.extract_text() or ''
            print(f'  テキスト長: {len(text)} chars')
            if text:
                print(f'  先頭200文字: {text[:200]}')

            tables = page.extract_tables()
            print(f'  テーブル数: {len(tables)}')

            for ti, table in enumerate(tables):
                if not table:
                    continue
                print(f'\n  [テーブル {ti}] 行数={len(table)}')
                # ヘッダー行を表示
                for ri, row in enumerate(table[:3]):
                    print(f'    行{ri}: {row}')

                # 列の特定
                header = table[0] if table else []
                name_col = None
                voltage_col = None
                avail_col = None   # 空き容量列
                cap_col = None     # 運用容量

                for ci, cell in enumerate(header):
                    c = str(cell or '').strip()
                    if '送電線' in c or '名称' in c or '線名' in c:
                        name_col = ci
                    elif '電圧' in c or 'kV' in c:
                        voltage_col = ci
                    elif '空' in c and ('容量' in c or 'き' in c):
                        if avail_col is None:
                            avail_col = ci
                    elif '運用' in c and '容量' in c:
                        cap_col = ci

                print(f'  → name_col={name_col}, voltage_col={voltage_col}, avail_col={avail_col}, cap_col={cap_col}')

                # データ行処理
                for row in table[1:]:
                    if not row or all(not c for c in row):
                        continue

                    # 送電線名
                    name = None
                    if name_col is not None and name_col < len(row):
                        name = str(row[name_col] or '').strip()

                    # 電圧
                    voltage_kv = None
                    if voltage_col is not None and voltage_col < len(row):
                        cell_v = str(row[voltage_col] or '').strip()
                        m = re.search(r'(\d+)', cell_v)
                        if m:
                            v = int(m.group(1))
                            if v in (66, 77, 154, 275, 500):
                                voltage_kv = v

                    # 空き容量
                    avail_mw = None
                    if avail_col is not None and avail_col < len(row):
                        avail_mw = parse_mw(row[avail_col])

                    if name and len(name) >= 2 and voltage_kv:
                        results.append({
                            'name': name,
                            'voltageKv': voltage_kv,
                            'availableMw': avail_mw,
                        })

    print(f'\n\n=== 抽出結果 ===')
    by_v = {}
    for r in results:
        v = r['voltageKv']
        by_v[v] = by_v.get(v, 0) + 1
    print(f'合計: {len(results)} 件 / 電圧分布: {by_v}')

    for r in results[:20]:
        print(f'  {r["name"]} ({r["voltageKv"]}kV) 空容量={r["availableMw"]}MW')

    # JSON保存
    out_path = 'tmp_tohoku_upper.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f'\n出力: {out_path}')


if __name__ == '__main__':
    main()
