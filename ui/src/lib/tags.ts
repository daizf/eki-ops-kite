export function getTagColor(tag: string): string {
  const colors = [
    'bg-purple-50 text-purple-700 border-purple-200',
    'bg-blue-50 text-blue-700 border-blue-200',
    'bg-green-50 text-green-700 border-green-200',
    'bg-yellow-50 text-yellow-700 border-yellow-200',
    'bg-pink-50 text-pink-700 border-pink-200',
    'bg-indigo-50 text-indigo-700 border-indigo-200',
    'bg-teal-50 text-teal-700 border-teal-200',
    'bg-orange-50 text-orange-700 border-orange-200',
    'bg-cyan-50 text-cyan-700 border-cyan-200',
    'bg-rose-50 text-rose-700 border-rose-200',
  ]
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

export function normalizeTags(tags: string[]): string[] {
  return tags
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .filter((t, i, arr) => arr.indexOf(t) === i)
}

export function getTagBadgeClassName(tag: string): string {
  const color = getTagColor(tag)
  return `text-xs ${color}`
}
