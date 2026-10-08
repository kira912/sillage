/** Choix exclusif entre quelques options, annoncé comme un groupe de boutons radio. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  block,
}: {
  label: string
  value: T
  options: [T, string][]
  onChange: (value: T) => void
  /** Occupe toute la largeur, options de même taille. */
  block?: boolean
}) {
  return (
    <div className={`segmented${block ? ' segmented--block' : ''}`} role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}
