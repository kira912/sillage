import { X } from 'lucide-react'
import { useRef, type ReactNode } from 'react'

export function Row({ icon, label, children, onClear }: { icon: ReactNode; label: string; children: ReactNode; onClear?: () => void }) {
  return (
    <div className="row">
      <span className="row__icon">{icon}</span>
      <span className="row__label">{label}</span>
      <div className="row__value">{children}</div>
      {onClear && (
        <button className="row__clear" onClick={onClear} aria-label={`Retirer ${label.toLowerCase()}`}>
          <X size={16} />
        </button>
      )}
    </div>
  )
}

/** Sélecteur natif (roue de l'iPhone) caché sous un libellé lisible. */
export function Picker({
  label,
  type,
  value,
  display,
  min,
  onChange,
}: {
  /** Nom annoncé par VoiceOver (le libellé visible est à côté, dans la ligne). */
  label: string
  type: 'date' | 'time'
  value: string
  display: string
  min?: string
  onChange: (v: string) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <span className={`picker${value ? '' : ' picker--empty'}`}>
      {display}
      <input
        ref={ref}
        className="picker__native"
        aria-label={label}
        type={type}
        value={value}
        min={min}
        onClick={() => {
          try {
            ref.current?.showPicker()
          } catch {
            /* showPicker non supporté : le champ natif s'ouvre tout seul */
          }
        }}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  )
}

export function SelectPicker({
  label,
  value,
  display,
  options,
  onChange,
}: {
  label: string
  value: string
  display: string
  options: [string, string][]
  onChange: (v: string) => void
}) {
  return (
    <span className={`picker${value ? '' : ' picker--empty'}`}>
      {display}
      <select className="picker__native" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>{text}</option>
        ))}
      </select>
    </span>
  )
}
