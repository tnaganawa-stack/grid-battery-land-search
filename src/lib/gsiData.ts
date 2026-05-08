/**
 * 国土地理院 (GSI) API データ取得
 * - 標高API: 座標から実標高を取得
 * - 逆ジオコーダー: 座標から都道府県・市区町村名を取得
 * （サーバーサイドのみ）
 */

const GSI_ELEVATION = "https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php";
const GSI_GEOCODER = "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress";

// 都道府県コード → 名称マップ
const PREF_CODES: Record<string, string> = {
  "04": "宮城県",
  "07": "福島県",
  "08": "茨城県",
  "09": "栃木県",
  "10": "群馬県",
  "11": "埼玉県",
  "12": "千葉県",
  "13": "東京都",
  "14": "神奈川県",
  "15": "新潟県",
  "19": "山梨県",
  "20": "長野県",
  "22": "静岡県",
};

// サイトIDごとのキャッシュ（サーバープロセス内で保持）
const elevCache = new Map<string, number>();
const addrCache = new Map<string, { prefecture: string; municipality: string }>();

function cacheKey(lat: number, lng: number) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/**
 * 国土地理院標高API — 指定座標の実標高(m)を返す
 */
export async function getElevation(lat: number, lng: number): Promise<number | null> {
  const key = cacheKey(lat, lng);
  if (elevCache.has(key)) return elevCache.get(key)!;

  try {
    const url = `${GSI_ELEVATION}?lon=${lng}&lat=${lat}&outtype=JSON`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { elevation?: string | number };
    const elev = parseFloat(String(data.elevation ?? ""));
    if (isNaN(elev)) return null;
    const rounded = Math.round(elev);
    elevCache.set(key, rounded);
    return rounded;
  } catch {
    return null;
  }
}

/**
 * 国土地理院逆ジオコーダー — 座標から都道府県・市区町村名を返す
 */
export async function getAddress(
  lat: number,
  lng: number
): Promise<{ prefecture: string; municipality: string } | null> {
  const key = cacheKey(lat, lng);
  if (addrCache.has(key)) return addrCache.get(key)!;

  try {
    const url = `${GSI_GEOCODER}?lon=${lng}&lat=${lat}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: { muniCd?: string; lv01Nm?: string };
    };
    const muniCd = data.results?.muniCd ?? "";
    const prefCode = muniCd.substring(0, 2);
    const result = {
      prefecture: PREF_CODES[prefCode] ?? "不明",
      municipality: data.results?.lv01Nm ?? "不明",
    };
    addrCache.set(key, result);
    return result;
  } catch {
    return null;
  }
}
