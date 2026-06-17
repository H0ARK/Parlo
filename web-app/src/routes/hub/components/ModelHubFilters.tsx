import { IconEye, IconTool } from '@tabler/icons-react'
import { Boxes } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export type ModelFormatFilter = 'all' | 'gguf' | 'mlx'
export type ModelCapabilityFilter = 'all' | 'tools' | 'vision'

type ModelHubFiltersProps = {
  formatFilter: ModelFormatFilter
  capabilityFilter: ModelCapabilityFilter
  counts: {
    all: number
    gguf: number
    mlx: number
    tools: number
    vision: number
  }
  onFormatFilterChange: (value: ModelFormatFilter) => void
  onCapabilityFilterChange: (value: ModelCapabilityFilter) => void
}

const formatOptions: Array<{ value: ModelFormatFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'gguf', label: 'GGUF' },
  { value: 'mlx', label: 'MLX' },
]

const capabilityOptions: Array<{ value: ModelCapabilityFilter; label: string }> = [
  { value: 'all', label: 'Any' },
  { value: 'tools', label: 'Tools' },
  { value: 'vision', label: 'Vision' },
]

function getCount(
  counts: ModelHubFiltersProps['counts'],
  value: ModelFormatFilter | ModelCapabilityFilter
) {
  if (value === 'all') return counts.all
  if (value === 'tools') return counts.tools
  if (value === 'vision') return counts.vision
  return counts[value]
}

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors',
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function ModelHubFilters({
  formatFilter,
  capabilityFilter,
  counts,
  onFormatFilterChange,
  onCapabilityFilterChange,
}: ModelHubFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 pb-3">
      <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-background/40 p-1">
        <span className="flex size-7 items-center justify-center text-muted-foreground">
          <Boxes className="size-3.5" />
        </span>
        {formatOptions.map((option) => (
          <Chip
            key={option.value}
            active={formatFilter === option.value}
            onClick={() => onFormatFilterChange(option.value)}
          >
            <span>{option.label}</span>
            <span className="text-[11px] text-muted-foreground">
              {getCount(counts, option.value)}
            </span>
          </Chip>
        ))}
      </div>
      <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-background/40 p-1">
        {capabilityOptions.map((option) => (
          <Chip
            key={option.value}
            active={capabilityFilter === option.value}
            onClick={() => onCapabilityFilterChange(option.value)}
          >
            {option.value === 'tools' ? <IconTool size={13} /> : null}
            {option.value === 'vision' ? <IconEye size={13} /> : null}
            <span>{option.label}</span>
            <span className="text-[11px] text-muted-foreground">
              {getCount(counts, option.value)}
            </span>
          </Chip>
        ))}
      </div>
    </div>
  )
}
