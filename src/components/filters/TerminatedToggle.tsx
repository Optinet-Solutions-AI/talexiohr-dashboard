'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface Props { checked: boolean }

export default function TerminatedToggle({ checked }: Props) {
  const router = useRouter()
  const params = useSearchParams()

  function toggle() {
    const next = new URLSearchParams(params.toString())
    if (checked) next.delete('terminated'); else next.set('terminated', '1')
    next.delete('page')
    router.push(`?${next.toString()}`)
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={toggle} className="accent-indigo-600" />
      Include terminated
    </label>
  )
}
