'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'

export interface StatusSlice {
  name: string
  value: number
  color: string
}

export default function StatusDonutChart({ data }: { data: StatusSlice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={data} cx="50%" cy="46%" innerRadius={65} outerRadius={90} paddingAngle={2} dataKey="value">
            {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
          </Pie>
          <Tooltip
            contentStyle={{ borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 11, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}
            formatter={(value) => { const n = Number(value); return [`${n} (${Math.round(n / total * 100)}%)`, ''] as [string, string] }}
          />
          <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ top: -16 }}>
        <p className="text-xl font-bold text-slate-700">{total}</p>
        <p className="text-[10px] text-slate-400">records</p>
      </div>
    </div>
  )
}
