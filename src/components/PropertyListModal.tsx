"use client";

import { useState, useEffect } from "react";
import { X, Download, Trash2, Plus, MapPin } from "lucide-react";
import StatusEditModal, { STATUS_OPTIONS, TYPE_OPTIONS } from "@/components/StatusEditModal";
import type { StatusData, PropertyStatus, PropertyType } from "@/components/StatusEditModal";

export const HOMES_STORAGE_KEY = "homes_properties_v1";

// StatusEditModal から再エクスポート（後方互換）
export type { PropertyStatus, PropertyType };

export interface HomesProperty {
  id: string;
  address: string;
  priceMen: number | null;
  areaSqm: number | null;
  lat: number;
  lng: number;
  nearestLineName: string;
  nearestLineKv: number;
  nearestDistM: number;
  nearestCapMw: number | null;
  nearestSubName: string;
  nearestSubDistM: number;
  nearestSubKv: number;
  nearestSubCapMw: number | null;
  status?: PropertyStatus;
  comment?: string;
  type?: PropertyType;
}

// ─── CSV エクスポート ─────────────────────────────────────────
function exportCSV(props: HomesProperty[]) {
  const BOM = "﻿";
  const headers = ["種別", "住所", "土地面積(m²)", "価格(万円)", "最寄送電線", "電圧(kV)", "最短距離(m)", "空き容量(MW)", "ステータス", "対応詳細"];
  const rows = props.map(p => [
    p.type ?? "高圧",
    p.address,
    p.areaSqm ?? "",
    p.priceMen ?? "",
    p.nearestLineName || "",
    p.nearestLineKv || "",
    p.nearestDistM > 0 ? Math.round(p.nearestDistM) : "",
    p.nearestCapMw ?? "",
    p.status ?? "未着手",
    p.comment ?? "",
  ]);
  const csv = [headers, ...rows]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `物件リスト_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── ジオコーディング ──────────────────────────────────────────
function geocodeCandidates(raw: string): string[] {
  const base = raw.replace(/[、，]/g, ",").split(",")[0].trim();
  const result: string[] = [base];
  let cur = base;
  const rules = [
    /[\s　]*\d+番\d*\s*$/,
    /[\s　]*番\d*\s*$/,
    /[\s　]*[\d\-]+\s*$/,
    /[\s　]*字\S+$/,
    /[\s　]*[^\s　]+$/,
  ];
  for (const rule of rules) {
    const next = cur.replace(rule, "").trim();
    if (next && next !== cur) { result.push(next); cur = next; }
  }
  return [...new Set(result)];
}

async function geocode(raw: string): Promise<{ lat: number; lng: number } | null> {
  for (const q of geocodeCandidates(raw)) {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&countrycodes=jp&accept-language=ja`,
      { headers: { "User-Agent": "grid-battery/1.0" } }
    );
    const data = await res.json();
    if (data.length) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    await new Promise(r => setTimeout(r, 300));
  }
  return null;
}

// ─── 追加フォーム ─────────────────────────────────────────────
function AddForm({ onAdd }: { onAdd: (p: HomesProperty) => void }) {
  const [address, setAddress] = useState("");
  const [price, setPrice]     = useState("");
  const [area, setArea]       = useState("");
  const [type, setType]       = useState<PropertyType>("高圧");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  async function handleSubmit() {
    if (!address.trim()) { setError("住所を入力してください"); return; }
    setLoading(true); setError("");
    const pos = await geocode(address);
    if (!pos) {
      setError("住所が見つかりませんでした（地番を省いてお試しください）");
      setLoading(false); return;
    }
    onAdd({
      id: `prop-${Date.now()}`,
      address: address.trim(),
      priceMen: price ? parseFloat(price) : null,
      areaSqm: area ? parseFloat(area) : null,
      lat: pos.lat, lng: pos.lng,
      nearestLineName: "", nearestLineKv: 0, nearestDistM: 0, nearestCapMw: null,
      nearestSubName: "", nearestSubDistM: 0, nearestSubKv: 0, nearestSubCapMw: null,
      status: "未着手", comment: "", type,
    });
    setAddress(""); setPrice(""); setArea("");
    setLoading(false);
  }

  return (
    <div className="border-b border-slate-200 bg-slate-50 p-4">
      <p className="text-[12px] text-slate-800 mb-3 font-semibold">HOMESの物件を登録</p>

      {/* 種別選択 */}
      <div className="flex gap-2 mb-2">
        {TYPE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setType(opt.value)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-bold border-2 transition-all"
            style={{
              borderColor: type === opt.value ? opt.border : "#e2e8f0",
              color: type === opt.value ? opt.color : "#94a3b8",
              background: type === opt.value ? opt.bg : "white",
            }}
          >
            <span>{opt.value}</span>
          </button>
        ))}
        <span className="text-[10px] text-slate-400 self-center ml-1">※ 高圧: 50kW以上、低圧: 50kW未満</span>
      </div>

      <div className="grid grid-cols-[1fr_100px_90px] gap-2 mb-2">
        <input
          value={address} onChange={e => setAddress(e.target.value)}
          placeholder="住所（例: 茨城県水戸市...）"
          className="text-[12px] text-slate-900 bg-white border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-indigo-400 placeholder:text-slate-400 col-span-3"
          onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
        />
        <input
          value={price} onChange={e => setPrice(e.target.value)}
          placeholder="価格（万円）"
          type="number"
          className="text-[12px] text-slate-900 bg-white border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-indigo-400 placeholder:text-slate-400"
        />
        <input
          value={area} onChange={e => setArea(e.target.value)}
          placeholder="面積（m²）"
          type="number"
          className="text-[12px] text-slate-900 bg-white border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-indigo-400 placeholder:text-slate-400"
        />
        <button
          onClick={handleSubmit} disabled={loading}
          className="flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white text-[11px] font-bold rounded-md transition-colors"
        >
          {loading ? <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Plus size={12} />}
          追加
        </button>
      </div>
      {error && <p className="text-[11px] text-red-600 font-medium">{error}</p>}
      <p className="text-[11px] text-slate-600 mt-1">
        ※ 送電線距離・空き容量は空き容量マップを開くと自動計算されます
      </p>
    </div>
  );
}

// ─── メインモーダル ────────────────────────────────────────────
export default function PropertyListModal({ onClose }: { onClose: () => void }) {
  const [properties, setProperties] = useState<HomesProperty[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [statusTarget, setStatusTarget] = useState<HomesProperty | null>(null);

  useEffect(() => {
    fetch('/api/homes-properties')
      .then(r => r.json())
      .then(data => setProperties(data))
      .catch(() => setProperties([]));
  }, []);

  async function handleAdd(p: HomesProperty) {
    await fetch('/api/homes-properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).catch(() => {});
    setProperties(prev => [...prev, p]);
    setShowAdd(false);
  }

  async function handleRemove(id: string) {
    await fetch('/api/homes-properties', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    setProperties(prev => prev.filter(p => p.id !== id));
  }

  function handleStatusSave(id: string, data: StatusData) {
    setProperties(prev => prev.map(p => p.id === id ? { ...p, ...data } : p));
  }

  async function handleRemoveAll() {
    if (!window.confirm(`登録済み ${properties.length} 件をすべて削除しますか？`)) return;
    await fetch('/api/homes-properties', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
    setProperties([]);
  }

  const distLabel = (m: number) =>
    m <= 0 ? "—" : m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;

  const distColor = (m: number) =>
    m <= 0 ? "#94a3b8" : m < 500 ? "#16a34a" : m < 2000 ? "#f97316" : "#ef4444";

  const capColor = (mw: number | null) =>
    mw == null ? "#94a3b8" : mw > 0 ? "#16a34a" : "#ef4444";

  return (
    <div className="fixed inset-0 z-[2000] flex">
      {/* オーバーレイ */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* ドロワー */}
      <div className="relative ml-auto w-full max-w-4xl h-full bg-white flex flex-col shadow-2xl">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-white flex-shrink-0">
          <div className="flex items-center gap-2">
            <MapPin size={16} className="text-indigo-500" />
            <span className="font-bold text-slate-800 text-[14px]">物件リスト</span>
            {properties.length > 0 && (
              <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                {properties.length} 件
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAdd(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
            >
              <Plus size={12} /> 物件追加
            </button>
            {properties.length > 0 && (
              <>
                <button
                  onClick={() => exportCSV(properties)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
                >
                  <Download size={12} /> Excelダウンロード
                </button>
                <button
                  onClick={handleRemoveAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition-colors"
                >
                  <Trash2 size={12} /> 全件削除
                </button>
              </>
            )}
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 追加フォーム */}
        {showAdd && <AddForm onAdd={handleAdd} />}

        {/* テーブル */}
        <div className="flex-1 overflow-auto">
          {properties.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
              <MapPin size={32} className="text-slate-300" />
              <p className="text-[13px]">物件が登録されていません</p>
              <button
                onClick={() => setShowAdd(true)}
                className="text-[11px] text-indigo-600 hover:underline"
              >＋ 物件を追加する</button>
            </div>
          ) : (
            <table className="w-full text-[11px] border-collapse">
              <thead className="sticky top-0 bg-slate-50 z-10">
                <tr>
                  {["種別", "ステータス", "住所", "土地面積", "価格", "最寄送電線", "電圧(線)", "送電線距離", "空き容量(線)", "最寄変電所", "電圧(変)", "変電所距離", "空き容量(変)", ""].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold text-slate-700 border-b border-slate-200 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {properties.map((p, i) => {
                  const sOpt = STATUS_OPTIONS.find(o => o.value === (p.status ?? "未着手")) ?? STATUS_OPTIONS[0];
                  const tOpt = TYPE_OPTIONS.find(o => o.value === (p.type ?? "高圧")) ?? TYPE_OPTIONS[0];
                  return (
                  <tr key={p.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/60"}>
                    {/* 種別バッジ */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                        style={{ background: tOpt.bg, color: tOpt.color, border: `1px solid ${tOpt.border}` }}
                      >
                        {p.type ?? "高圧"}
                      </span>
                    </td>
                    {/* ステータスバッジ */}
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => setStatusTarget(p)}
                        className="flex flex-col items-start gap-0.5 group"
                        title={p.comment || "クリックでステータス・種別編集"}
                      >
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap group-hover:opacity-80 transition-opacity"
                          style={{ background: sOpt.bg, color: sOpt.color, border: `1px solid ${sOpt.border}` }}
                        >
                          {p.status ?? "未着手"}
                        </span>
                        {p.comment && (
                          <span className="text-[9px] text-slate-400 max-w-[90px] truncate">{p.comment}</span>
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-slate-900 max-w-[220px]">
                      <span title={p.address}>{p.address.length > 28 ? p.address.slice(0, 28) + "…" : p.address}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-900 whitespace-nowrap">
                      {p.areaSqm != null ? `${p.areaSqm.toLocaleString()} m²` : "—"}
                    </td>
                    <td className="px-3 py-2.5 font-bold text-indigo-800 whitespace-nowrap">
                      {p.priceMen != null ? `${p.priceMen.toLocaleString()} 万円` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-slate-900 max-w-[160px]">
                      <span title={p.nearestLineName}>
                        {p.nearestLineName
                          ? (p.nearestLineName.length > 16 ? p.nearestLineName.slice(0, 16) + "…" : p.nearestLineName)
                          : <span className="text-slate-400 text-[10px]">未計算</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-800 whitespace-nowrap">
                      {p.nearestLineKv ? `${p.nearestLineKv} kV` : "—"}
                    </td>
                    <td className="px-3 py-2.5 font-bold whitespace-nowrap" style={{ color: distColor(p.nearestDistM) }}>
                      {distLabel(p.nearestDistM)}
                    </td>
                    <td className="px-3 py-2.5 font-bold whitespace-nowrap" style={{ color: capColor(p.nearestCapMw) }}>
                      {p.nearestDistM > 0
                        ? (p.nearestCapMw != null ? `${p.nearestCapMw} MW` : "不明")
                        : <span className="text-slate-400 text-[10px]">未計算</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-900 max-w-[160px]">
                      <span title={p.nearestSubName}>
                        {p.nearestSubDistM > 0
                          ? (p.nearestSubName.length > 14 ? p.nearestSubName.slice(0, 14) + "…" : p.nearestSubName)
                          : <span className="text-slate-400 text-[10px]">未計算</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-800 whitespace-nowrap">
                      {p.nearestSubDistM > 0 && p.nearestSubKv ? `${p.nearestSubKv} kV` : "—"}
                    </td>
                    <td className="px-3 py-2.5 font-bold whitespace-nowrap" style={{ color: distColor(p.nearestSubDistM) }}>
                      {distLabel(p.nearestSubDistM)}
                    </td>
                    <td className="px-3 py-2.5 font-bold whitespace-nowrap" style={{ color: p.nearestSubCapMw != null && p.nearestSubCapMw >= 0 ? capColor(p.nearestSubCapMw) : "#94a3b8" }}>
                      {p.nearestSubDistM > 0
                        ? (p.nearestSubCapMw == null ? "未計算" : p.nearestSubCapMw < 0 ? "要確認" : `${p.nearestSubCapMw} MW`)
                        : <span className="text-slate-400 text-[10px]">未計算</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => handleRemove(p.id)}
                        className="text-red-400 hover:text-red-600 hover:bg-red-50 rounded p-1 transition-colors"
                        title="削除"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* フッター */}
        {properties.length > 0 && (
          <div className="px-5 py-2 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-400 flex-shrink-0">
            距離・空き容量が「未計算」の場合は空き容量マップを開くと自動で計算されます
          </div>
        )}
      </div>

      {/* ステータス編集モーダル */}
      {statusTarget && (
        <StatusEditModal
          propertyId={statusTarget.id}
          address={statusTarget.address}
          initialStatus={statusTarget.status ?? "未着手"}
          initialComment={statusTarget.comment ?? ""}
          initialType={statusTarget.type ?? "高圧"}
          onSave={handleStatusSave}
          onClose={() => setStatusTarget(null)}
        />
      )}
    </div>
  );
}
