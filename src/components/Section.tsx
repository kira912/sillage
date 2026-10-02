import type { ReactNode } from 'react'

export function Section({ title, tone, children }: { title: string; tone?: 'warn'; children: ReactNode }) {
  return (
    <div className="section">
      <h2 className={`section__title${tone ? ` section__title--${tone}` : ''}`}>{title}</h2>
      <div className="list">{children}</div>
    </div>
  )
}
