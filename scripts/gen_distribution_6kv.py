"""
6.6kV 配電用変電所空き容量 抽出スクリプト

対象PDF:
  - data/東京/系統空き容量_*.pdf  (TEPCO フォーマット: 配電用変電所エリア)
  - data/東北/変電所予想潮流_*.pdf (東北 フォーマット: Section(2)配電用変圧器等)
  - data/関西/154kV未満空き容量.pdf (関西 フォーマット: 一次/二次列)

ヘッダー行から列位置を動的に検出することでスケール差異を吸収する。

出力: src/data/distribution_6kv_substations.json
  [{ name, prefecture, primaryKv, secondaryKv, availableMw, source }, ...]
"""

import fitz
import json
import re
import os
import sys
import glob

sys.stdout = __import__('io').TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

OUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'distribution_6kv_substations.json')


def parse_mw(s: str):
    s = s.strip().replace('－', '-').replace('ー', '-').replace('—', '-').replace('―', '-')
    if not s or s in ('-', '－', 'ー', '—', '―'):
        return None
    try:
        v = int(s)
        return v if v > 0 else None
    except ValueError:
        return None


def rows_from_words(words):
    """ワードリストをy座標でグループ化して行辞書を返す"""
    rows = {}
    for w in words:
        x0, y0, x1, y1, text = w[0], w[1], w[2], w[3], w[4]
        text = text.strip()
        if not text:
            continue
        y_key = round(y0 / 4) * 4
        rows.setdefault(y_key, []).append((x0, text))
    return {y: sorted(c, key=lambda c: c[0]) for y, c in rows.items()}


def cell_at(cells, x_center, tolerance=None):
    """x_center に最も近いセル値を返す。tolerance=None なら幅の1/3を使う"""
    if tolerance is None:
        tolerance = x_center * 0.15  # 15%
    matches = [(abs(x - x_center), v) for x, v in cells if abs(x - x_center) <= tolerance]
    if not matches:
        return ''
    return sorted(matches)[0][1]


def cells_in_range(cells, x_min, x_max):
    return ''.join(v for x, v in cells if x_min <= x <= x_max)


def find_header_positions(row_map):
    """
    ヘッダー行から主要列の x 座標を検出する。
    戻り値: { 'name': x, 'primary': x, 'secondary': x, 'avail_equip': x, 'avail_upper': x }
    または None（ヘッダーが見つからない場合）
    """
    for y, cells in sorted(row_map.items()):
        texts = [v for _, v in cells]
        # ヘッダー行の特徴: '一次' と '二次' が含まれる
        if '一次' in texts and '二次' in texts:
            pos = {}
            for x, v in cells:
                if v == '一次':
                    pos['primary'] = x
                elif v == '二次':
                    pos['secondary'] = x
                elif v in ('当該設備', '当該'):
                    if 'avail_equip' not in pos:
                        pos['avail_equip'] = x
                elif v in ('上位系等考慮', '上位系等'):
                    pos['avail_upper'] = x
            if 'primary' in pos and 'secondary' in pos:
                return pos, y
    return None, None


# ─────────────────────────────────────────────────────────────────
# 汎用抽出ロジック (ヘッダー検出ベース)
# ─────────────────────────────────────────────────────────────────
def extract_6kv_from_page(page, header_x, section_y_start, section_y_end=None):
    """
    1ページから 二次電圧=6.6 のエントリを抽出する。
    header_x: { 'primary', 'secondary', 'avail_equip'(opt), 'avail_upper'(opt) }
    """
    words = page.get_text('words')
    row_map = rows_from_words(words)
    results = []
    tol_mult = 0.18  # 列位置の許容範囲 (18%)

    for y, cells in sorted(row_map.items()):
        if y <= section_y_start:
            continue
        if section_y_end and y > section_y_end:
            break

        # 二次電圧列を確認
        sec_x = header_x['secondary']
        tol = max(sec_x * tol_mult, 15)
        secondary_val = cell_at(cells, sec_x, tol)
        if '6.6' not in secondary_val:
            continue

        # 設備名 (一次電圧より左の最長テキスト)
        pri_x = header_x['primary']
        name_candidates = [(x, v) for x, v in cells if x < pri_x - 10]
        if not name_candidates:
            continue
        # 一番右の値が No, その次が name の場合が多い
        # → 数字以外の最右端値を name とする
        name = ''
        for x, v in sorted(name_candidates, reverse=True):
            if not re.match(r'^\d+$', v):
                name = v
                break
        if not name:
            continue

        # 一次電圧
        pri_tol = max(pri_x * tol_mult, 15)
        primary_str = cell_at(cells, pri_x, pri_tol)
        try:
            primary_kv = int(primary_str)
        except ValueError:
            primary_kv = 66

        # 空き容量
        avail_equip = None
        avail_upper = None
        if 'avail_equip' in header_x:
            eq_x = header_x['avail_equip']
            avail_equip = parse_mw(cell_at(cells, eq_x, max(eq_x * tol_mult, 15)))
        if 'avail_upper' in header_x:
            up_x = header_x['avail_upper']
            avail_upper = parse_mw(cell_at(cells, up_x, max(up_x * tol_mult, 15)))

        avail = avail_equip if avail_equip is not None else avail_upper
        if avail is None:
            continue

        results.append({
            'name': name,
            'primaryKv': primary_kv,
            'availableMw': avail,
        })

    return results


# ─────────────────────────────────────────────────────────────────
# TEPCO フォーマット (配電用変電所エリア) - 固定 x 範囲で抽出
# 千葉・埼玉・茨城・栃木・神奈川・山梨・静岡 で共通
# 列: 変電所名(x≈120-165), 二次電圧"6.6以下"(x≈269-295),
#     当該設備空容量(x≈424-445), 上位系等考慮(x≈454-472)
# ─────────────────────────────────────────────────────────────────
def extract_tepco(pdf_path: str, prefecture: str):
    doc = fitz.open(pdf_path)
    all_results = []

    for pn in range(len(doc)):
        page = doc[pn]
        text = page.get_text('text')
        if '6.6以下' not in text:
            continue
        if '配電用変電所' not in text:
            continue

        words = page.get_text('words')
        row_map = rows_from_words(words)

        for y, cells in sorted(row_map.items()):
            # 二次電圧列 (x≈269-295) に "6.6" があるか
            secondary = cells_in_range(cells, 269, 295)
            if '6.6' not in secondary:
                continue

            # 変電所名 (x≈120-165)
            name = cells_in_range(cells, 120, 165)
            if not name or any(k in name for k in ['変電所名', '一次', '二次', '配電用', 'No']):
                continue
            if len(name) < 2:
                continue

            # 空き容量
            avail_equip = parse_mw(cells_in_range(cells, 424, 445))
            avail_upper = parse_mw(cells_in_range(cells, 454, 472))
            avail = avail_equip if avail_equip is not None else avail_upper
            if avail is None:
                continue

            all_results.append({
                'name': name,
                'prefecture': prefecture,
                'primaryKv': 66,
                'secondaryKv': 6.6,
                'availableMw': avail,
                'source': 'TEPCO',
            })

    seen = set()
    unique = []
    for r in all_results:
        k = (r['name'], r['prefecture'])
        if k not in seen:
            seen.add(k)
            unique.append(r)
    print(f'  {prefecture}: {len(unique)} 件')
    return unique


# ─────────────────────────────────────────────────────────────────
# 東北 フォーマット (Section(2) 配電用変圧器等)
# ─────────────────────────────────────────────────────────────────
def extract_tohoku(pdf_path: str, prefecture: str):
    doc = fitz.open(pdf_path)
    all_results = []

    for pn in range(len(doc)):
        page = doc[pn]
        text = page.get_text('text')
        if '配電用変圧器' not in text:
            continue

        words = page.get_text('words')
        row_map = rows_from_words(words)

        # Section(2) の開始y座標を探す
        sec2_y = None
        for y, cells in sorted(row_map.items()):
            row_text = ''.join(v for _, v in cells)
            if '配電用変圧器' in row_text:
                sec2_y = y
                break
        if sec2_y is None:
            continue

        # ヘッダー行 (sec2_y 以降の "一次" "二次" を含む行)
        header_x = None
        header_y = sec2_y
        for y, cells in sorted(row_map.items()):
            if y <= sec2_y:
                continue
            texts = [v for _, v in cells]
            if '一次' in texts and '二次' in texts:
                hx = {}
                for x, v in cells:
                    if v == '一次':
                        hx['primary'] = x
                    elif v == '二次':
                        hx['secondary'] = x
                    elif v in ('当該設備', '当該'):
                        if 'avail_equip' not in hx:
                            hx['avail_equip'] = x
                    elif v in ('上位系等考慮', '上位系等'):
                        hx['avail_upper'] = x
                if 'primary' in hx and 'secondary' in hx:
                    header_x = hx
                    header_y = y
                    break

        if not header_x:
            # フォールバック (宮城スケール)
            header_x = {'primary': 134, 'secondary': 166, 'avail_equip': 369, 'avail_upper': 410}

        # avail_upper 補完
        if 'avail_upper' not in header_x:
            header_x['avail_upper'] = header_x.get('avail_equip', 410) + 40

        # データ行抽出
        for y, cells in sorted(row_map.items()):
            if y <= header_y:
                continue

            sec_x = header_x['secondary']
            tol = max(sec_x * 0.12, 12)
            secondary_val = cell_at(cells, sec_x, tol)
            if '6.6' not in secondary_val:
                continue

            pri_x = header_x['primary']
            name_candidates = [(x, v) for x, v in cells if x < pri_x - 10]
            if not name_candidates:
                continue
            name = ''
            for x, v in sorted(name_candidates, reverse=True):
                if not re.match(r'^\d+$', v) and v not in ('設備名', '一次', '二次', '配電用'):
                    name = v
                    break
            if not name or len(name) < 2:
                continue

            eq_x = header_x.get('avail_equip', 369)
            up_x = header_x.get('avail_upper', 410)
            avail_equip = parse_mw(cell_at(cells, eq_x, max(eq_x * 0.06, 15)))
            avail_upper = parse_mw(cell_at(cells, up_x, max(up_x * 0.06, 15)))
            avail = avail_equip if avail_equip is not None else avail_upper
            if avail is None:
                continue

            # 一次電圧
            pri_tol = max(pri_x * 0.12, 12)
            primary_str = cell_at(cells, pri_x, pri_tol)
            try:
                primary_kv = int(primary_str)
            except ValueError:
                primary_kv = 66

            all_results.append({
                'name': name,
                'prefecture': prefecture,
                'primaryKv': primary_kv,
                'secondaryKv': 6.6,
                'availableMw': avail,
                'source': '東北電力NW',
            })

    seen = set()
    unique = []
    for r in all_results:
        k = (r['name'], r['prefecture'])
        if k not in seen:
            seen.add(k)
            unique.append(r)
    print(f'  {prefecture}: {len(unique)} 件')
    return unique


# ─────────────────────────────────────────────────────────────────
# 関西 フォーマット (154kV未満空き容量)
# ─────────────────────────────────────────────────────────────────
def extract_kansai(pdf_path: str):
    doc = fitz.open(pdf_path)
    all_results = []

    for pn in range(len(doc)):
        page = doc[pn]
        text = page.get_text('text')
        if '6.6' not in text:
            continue

        words = page.get_text('words')
        row_map = rows_from_words(words)

        # ヘッダー行を検出
        header_x, header_y = find_header_positions(row_map)
        if not header_x:
            # フォールバック (関西スケール)
            header_x = {'primary': 102, 'secondary': 121, 'avail_equip': 273, 'avail_upper': 307}
            header_y = 0

        if 'avail_upper' not in header_x:
            header_x['avail_upper'] = header_x.get('avail_equip', 273) + 35

        for y, cells in sorted(row_map.items()):
            if y <= header_y:
                continue

            sec_x = header_x['secondary']
            tol = max(sec_x * 0.12, 10)
            secondary_val = cell_at(cells, sec_x, tol)
            if secondary_val not in ('6.6', '６.６', '6.6kV'):
                continue

            pri_x = header_x['primary']
            name_candidates = [(x, v) for x, v in cells if x < pri_x - 5]
            if not name_candidates:
                continue
            name = ''
            for x, v in sorted(name_candidates, reverse=True):
                if not re.match(r'^[A-Z０-９\d]+[A-Z]?$', v) and v not in ('設備名', '一次', '二次'):
                    name = v
                    break
            if not name or len(name) < 2:
                continue

            pri_tol = max(pri_x * 0.12, 10)
            primary_str = cell_at(cells, pri_x, pri_tol)
            try:
                primary_kv = int(primary_str)
            except ValueError:
                primary_kv = 77

            eq_x = header_x.get('avail_equip', 273)
            up_x = header_x.get('avail_upper', 307)
            avail_equip = parse_mw(cell_at(cells, eq_x, max(eq_x * 0.08, 12)))
            avail_upper = parse_mw(cell_at(cells, up_x, max(up_x * 0.08, 12)))
            avail = avail_equip if avail_equip is not None else avail_upper
            if avail is None:
                continue

            all_results.append({
                'name': name,
                'prefecture': '関西',
                'primaryKv': primary_kv,
                'secondaryKv': 6.6,
                'availableMw': avail,
                'source': '関西電力送配電',
            })

    seen = set()
    unique = []
    for r in all_results:
        k = (r['name'], r['prefecture'])
        if k not in seen:
            seen.add(k)
            unique.append(r)
    print(f'  関西: {len(unique)} 件')
    return unique


# ─────────────────────────────────────────────────────────────────
# メイン
# ─────────────────────────────────────────────────────────────────
def pref_from_path(path: str) -> str:
    base = os.path.basename(path)
    m = re.search(r'[_・]([^_・]+?)\.pdf', base)
    return m.group(1) if m else base.replace('.pdf', '')


def main():
    all_results = []

    # TEPCO (東京エリア)
    print('\n=== TEPCO (配電用変電所エリア) ===')
    for pdf in sorted(glob.glob('data/東京/系統空き容量_*.pdf')):
        pref = pref_from_path(pdf)
        try:
            all_results.extend(extract_tepco(pdf, pref))
        except Exception as e:
            print(f'  [ERR] {pdf}: {e}')

    # 東北
    print('\n=== 東北電力 (変電所予想潮流) ===')
    for pdf in sorted(glob.glob('data/東北/変電所予想潮流_*.pdf')):
        pref = pref_from_path(pdf)
        try:
            all_results.extend(extract_tohoku(pdf, pref))
        except Exception as e:
            print(f'  [ERR] {pdf}: {e}')

    # 関西
    print('\n=== 関西電力送配電 (154kV未満空き容量) ===')
    kansai_pdf = 'data/関西/154kV未満空き容量.pdf'
    if os.path.exists(kansai_pdf):
        try:
            all_results.extend(extract_kansai(kansai_pdf))
        except Exception as e:
            print(f'  [ERR] {kansai_pdf}: {e}')
    else:
        print('  ファイルが見つかりません')

    print(f'\n合計: {len(all_results)} 件')

    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    print(f'保存: {OUT_PATH}')
    print('\nサンプル:')
    for r in all_results[:5]:
        print(f'  {r}')


if __name__ == '__main__':
    main()
