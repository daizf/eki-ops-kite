import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { getTagColor } from '@/lib/tags'

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function TagInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: TagInputProps) {
  const [currentTag, setCurrentTag] = useState('')

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag()
    } else if (e.key === 'Backspace' && currentTag === '' && value.length > 0) {
      removeTag(value.length - 1)
    }
  }

  const addTag = () => {
    const trimmed = currentTag.trim()
    if (trimmed && !value.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      onChange([...value, trimmed])
    }
    setCurrentTag('')
  }

  const removeTag = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <div className={`flex flex-wrap gap-2 p-2 border rounded-md min-h-[42px] ${className}`}>
      {value.map((tag, index) => (
        <Badge key={index} variant="outline" className={getTagColor(tag)}>
          {tag}
          {!disabled && (
            <button
              type="button"
              onClick={() => removeTag(index)}
              className="ml-1 hover:text-destructive"
            >
              ×
            </button>
          )}
        </Badge>
      ))}
      <Input
        type="text"
        value={currentTag}
        onChange={(e) => setCurrentTag(e.target.value)}
        onBlur={addTag}
        onKeyDown={handleKeyDown}
        placeholder={placeholder && value.length === 0 ? placeholder : ''}
        disabled={disabled}
        className="flex-1 min-w-[100px] border-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-6 text-sm"
      />
    </div>
  )
}
