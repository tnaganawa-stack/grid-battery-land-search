'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

const FIELD_GROUPS = [
  {
    label: '基本情報',
    fields: [
      { key: 'name', label: '物件名', required: true, type: 'text' },
      { key: 'saleNumber', label: '売却番号', required: false, type: 'text' },
      { key: 'source', label: '情報源', required: false, type: 'text', placeholder: '例: 伊勢崎市公売' },
      { key: 'contact', label: '問い合わせ先', required: false, type: 'text' },
    ],
  },
  {
    label: '所在地',
    fields: [
      { key: 'prefecture', label: '都道府県', required: false, type: 'text', placeholder: '例: 群馬県' },
      { key: 'municipality', label: '市区町村', required: false, type: 'text', placeholder: '例: 伊勢崎市' },
      { key: 'address', label: '住所', required: false, type: 'text' },
      { key: 'lat', label: '緯度', required: true, type: 'number', placeholder: '例: 36.275738' },
      { key: 'lng', label: '経度', required: true, type: 'number', placeholder: '例: 139.242447' },
    ],
  },
  {
    label: '土地情報',
    fields: [
      { key: 'areaM2', label: '面積 (m²)', required: false, type: 'number' },
      { key: 'landType', label: '地目', required: false, type: 'text', placeholder: '例: 宅地・農地・雑種地' },
      { key: 'zoningType', label: '用途地域', required: false, type: 'text' },
      { key: 'topography', label: '地形', required: false, type: 'text', placeholder: '例: 概ね平坦' },
      { key: 'shape', label: '形状', required: false, type: 'text' },
      { key: 'accessRoad', label: '接道状況', required: false, type: 'text' },
    ],
  },
  {
    label: '価格',
    fields: [
      { key: 'estimatedPrice', label: '見積価格 (円)', required: false, type: 'number' },
      { key: 'depositAmount', label: '保証金 (円)', required: false, type: 'number' },
    ],
  },
  {
    label: '備考',
    fields: [
      { key: 'currentUse', label: '現況', required: false, type: 'text' },
      { key: 'notes', label: '特記事項', required: false, type: 'textarea' },
    ],
  },
]

export default function NewPropertyPage() {
  const router = useRouter()
  const [form, setForm] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function handleChange(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const body = {
        ...form,
        lat: parseFloat(form.lat ?? '0'),
        lng: parseFloat(form.lng ?? '0'),
        areaM2: parseFloat(form.areaM2 ?? '0'),
        areaHa: parseFloat(form.areaM2 ?? '0') / 10000,
        estimatedPrice: parseInt(form.estimatedPrice ?? '0'),
        depositAmount: parseInt(form.depositAmount ?? '0'),
        buildingCoverage: parseInt(form.buildingCoverage ?? '0'),
        floorAreaRatio: parseInt(form.floorAreaRatio ?? '0'),
        waterSupply: false,
        sewer: false,
        gas: false,
      }

      const res = await fetch('/api/auction-properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) throw new Error('登録に失敗しました')

      router.push('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : '登録に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => router.push('/')}
          className="text-gray-500 hover:text-gray-700 text-sm"
        >
          ← 戻る
        </button>
        <h1 className="text-lg font-semibold text-gray-900">物件登録</h1>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {FIELD_GROUPS.map(group => (
            <div key={group.label} className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">{group.label}</h2>
              <div className="space-y-4">
                {group.fields.map(field => (
                  <div key={field.key}>
                    <label className="block text-sm text-gray-600 mb-1">
                      {field.label}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {field.type === 'textarea' ? (
                      <textarea
                        rows={4}
                        placeholder={field.placeholder}
                        value={form[field.key] ?? ''}
                        onChange={e => handleChange(field.key, e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    ) : (
                      <input
                        type={field.type}
                        step={field.type === 'number' ? 'any' : undefined}
                        required={field.required}
                        placeholder={field.placeholder}
                        value={form[field.key] ?? ''}
                        onChange={e => handleChange(field.key, e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {error && (
            <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-700 disabled:bg-brand-300 text-white font-medium py-3 rounded-lg transition-colors text-sm"
          >
            {loading ? '登録中...' : '物件を登録する'}
          </button>
        </form>
      </div>
    </div>
  )
}
