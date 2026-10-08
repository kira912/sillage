import { parseLine } from '../lib/richtext'

/** Une ligne de texte balisé, affichée avec sa mise en forme. */
export function RichLine({ text }: { text: string }) {
  return (
    <>
      {parseLine(text).map(({ text: t, marks }, i) => {
        const cls = [marks.b && 'rt-b', marks.i && 'rt-i', marks.u && 'rt-u', marks.s && 'rt-s'].filter(Boolean).join(' ')
        if (!cls && !marks.color) return t
        return (
          <span key={i} className={cls || undefined} data-color={marks.color}>
            {t}
          </span>
        )
      })}
    </>
  )
}
