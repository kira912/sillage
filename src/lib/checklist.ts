export const CHECK_RE = /^(\s*)- \[( |x)\] ?(.*)$/i

export function checklistProgress(body: string): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const line of body.split('\n')) {
    const m = line.match(CHECK_RE)
    if (!m) continue
    total++
    if (m[2].toLowerCase() === 'x') done++
  }
  return { done, total }
}

export function toggleLine(body: string, index: number): string {
  const lines = body.split('\n')
  lines[index] = lines[index].replace(CHECK_RE, (_, indent, mark, text) => `${indent}- [${mark === ' ' ? 'x' : ' '}] ${text}`)
  return lines.join('\n')
}

export const uncheckAll = (body: string) => body.replace(/^(\s*)- \[x\]/gim, '$1- [ ]')

/** Retire les éléments cochés (ex. après les courses). */
export const removeChecked = (body: string) =>
  body
    .split('\n')
    .filter((l) => !/^\s*- \[x\]/i.test(l))
    .join('\n')
