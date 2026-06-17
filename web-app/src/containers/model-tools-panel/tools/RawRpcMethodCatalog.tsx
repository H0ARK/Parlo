import { Input } from '@/components/ui/input'

export type RawRpcCatalogItem = {
  group: string
  method: string
  params: Record<string, unknown>
  description: string
}

type RawRpcMethodCatalogProps = {
  filter: string
  items: RawRpcCatalogItem[]
  totalCount: number
  onFilterChange: (value: string) => void
  onSelect: (method: string, params: Record<string, unknown>) => void
}

export function RawRpcMethodCatalog({
  filter,
  items,
  totalCount,
  onFilterChange,
  onSelect,
}: RawRpcMethodCatalogProps) {
  return (
    <>
      <Input
        className="mb-1 h-6 px-2 text-[10px]"
        placeholder="Search app-server method catalog"
        value={filter}
        onChange={(event) => onFilterChange(event.target.value)}
      />
      <div className="mb-1 rounded border bg-background/40 p-1">
        <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[9px]">
          <span>Method catalog</span>
          <span className="text-muted-foreground">
            {items.length}/{totalCount}
          </span>
        </div>
        <div className="max-h-28 space-y-1 overflow-auto">
          {items.map((item) => (
            <button
              key={`${item.group}:${item.method}`}
              type="button"
              className="block w-full rounded border px-1.5 py-1 text-left hover:bg-accent"
              title={item.description}
              onClick={() => onSelect(item.method, item.params)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[9px]">
                  {item.method}
                </span>
                <span className="shrink-0 text-[9px] text-muted-foreground">
                  {item.group}
                </span>
              </div>
              <div className="truncate text-[9px] text-muted-foreground">
                {item.description}
              </div>
            </button>
          ))}
          {!items.length ? (
            <div className="rounded border px-1.5 py-2 text-[9px] text-muted-foreground">
              No matching app-server methods.
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
