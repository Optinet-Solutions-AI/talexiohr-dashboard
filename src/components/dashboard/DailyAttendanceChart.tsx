'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'

export interface DayData {
  label: string
  office: number
  wfh: number
  remote: number
  vacation: number
  no_clocking: number
  unknown: number
}

const COLORS = {
  office:      '#4f46e5', // indigo-600
  wfh:         '#818cf8', // indigo-400
  remote:      '#a5b4fc', // indigo-300
  vacation:    '#c7d2fe', // indigo-200
  no_clocking: '#ddd6fe', // violet-200
  unknown:     '#ede9fe', // violet-100
}

const LABELS = {
  office: 'Office', wfh: 'WFH', remote: 'Remote',
  vacation: 'Leave', no_clocking: 'No Clocking', unknown: 'Other',
}

export default function DailyAttendanceChart({ data }: { data: DayData[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ borderRadius: 6, border: '1px solid #c7d2fe', fontSize: 11, boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}
          cursor={{ fill: '#eef2ff' }}
        />
        <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
        {(Object.keys(COLORS) as (keyof typeof COLORS)[]).map(key => (
          <Bar key={key} dataKey={key} name={LABELS[key]} stackId="a" fill={COLORS[key]} radius={key === 'unknown' ? [2, 2, 0, 0] : undefined} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
