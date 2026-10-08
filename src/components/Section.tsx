import type { ReactNode } from 'react'

interface Props {
  title: string
  /** `day` : nom de jour, dans l'italique des titres. */
  variant?: 'day'
  tone?: 'warn'
  /** Contenu déjà mis en forme (ligne du jour) plutôt qu'une liste de cartes. */
  bare?: boolean
  children: ReactNode
}

export function Section({ title, variant, tone, bare, children }: Props) {
  const cls = ['section__title', variant && `section__title--${variant}`, tone && `section__title--${tone}`].filter(Boolean).join(' ')
  return (
    <section className="section">
      <h2 className={cls}>{title}</h2>
      {bare ? children : <div className="list">{children}</div>}
    </section>
  )
}
