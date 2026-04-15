'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'

export interface DayData {
  label: string   // "Mon 6"
  office: number
  wfh: number
  remote: number
  vacation: number
  no_clocking: number
  unknown: number
}

const COLORS = {
  office:      '#10b981',
  wfh:         '#3b82f6',
  remote:      '#f59e0b',
  vacation:    '#8b5cf6',
  no_clocking: '#9ca3af',
  unknown:     '#d1d5db',
}

const LABELS = {
  office: 'Office', wfh: 'WFH', remote: 'Remote',
  vacation: 'Vacation', no_clocking: 'No Clocking', unknown: 'Unknown',
}

export default function DailyAttendanceChart({ data }: { data: DayData[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
          cursor={{ fill: '#f9fafb' }}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        {(Object.keys(COLORS) as (keyof typeof COLORS)[]).map(key => (
          <Bar key={key} dataKey={key} name={LABELS[key]} stackId="a" fill={COLORS[key]} radius={key === 'unknown' ? [3,3,0,0] : undefined} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
