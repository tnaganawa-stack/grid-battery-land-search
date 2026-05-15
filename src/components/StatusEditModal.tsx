"use client";

import { useState } from "react";
import { X } from "lucide-react";

export type PropertyStatus = "未着手" | "事前協議中" | "接続検討中";

export interface StatusData {
  status: PropertyStatus;
  comment: string;
}

interface Props {
  propertyId: string;
  address: string;
  initialStatus: PropertyStatus;
  initialComment: string;
  onSave: (id: string, data: StatusData) => void;
  onClose: () => void;
}

export const STATUS_OPTIONS: { value: PropertyStatus; color: string; bg: string; border: string }[] = [
  { value: "未着手",    color: "#64748b", bg: "#f1f5f9", border: "#cbd5e1" },
  { value: "事前協議中", color: "#d97706", bg: "#fffbeb", border: "#fcd34d" },
  { value: "接続検討中", color: "#2563eb", bg: "#eff6ff", border: "#93c5fd" },
];

export function statusColor(status: PropertyStatus | undefined): string {
  return STATUS_OPTIONS.find(o => o.value === status)?.color ?? "#94a3b8";
}

export function statusBg(status: PropertyStatus | undefined): string {
  return STATUS_OPTIONS.find(o => o.value === status)?.bg ?? "#f8fafc";
}

export default function StatusEditModal({
  propertyId,
  address,
  initialStatus,
  initialComment,
  onSave,
  onClose,
}: Props) {
  const [status, setStatus] = useState<PropertyStatus>(initialStatus);
  const [comment, setComment] = useState(initialComment);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await fetch("/api/homes-properties", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: propertyId, status, comment }),
    }).catch(() => {});
    onSave(propertyId, { status, comment });
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-[420px] p-5">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800 text-[14px]">ステータス更新</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* 住所 */}
        <p className="text-[11px] text-slate-500 mb-4 leading-relaxed break-all">{address}</p>

        {/* ステータス選択 */}
        <div className="mb-4">
          <p className="text-[11px] font-semibold text-slate-700 mb-2">ステータス</p>
          <div className="flex gap-2">
            {STATUS_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setStatus(opt.value)}
                className="flex-1 py-2.5 rounded-lg text-[11px] font-bold border-2 transition-all"
                style={{
                  borderColor: status === opt.value ? opt.border : "#e2e8f0",
                  color: status === opt.value ? opt.color : "#94a3b8",
                  background: status === opt.value ? opt.bg : "white",
                }}
              >
                {opt.value}
              </button>
            ))}
          </div>
        </div>

        {/* コメント */}
        <div className="mb-5">
          <p className="text-[11px] font-semibold text-slate-700 mb-2">対応詳細</p>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="対応内容・メモを入力..."
            rows={4}
            className="w-full text-[12px] text-slate-900 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-400 placeholder:text-slate-400 resize-none"
          />
        </div>

        {/* ボタン */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 rounded-lg transition-colors"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
