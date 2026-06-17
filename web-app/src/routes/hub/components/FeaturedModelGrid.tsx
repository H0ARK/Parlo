import { IconDownload, IconEye, IconFileCode, IconTool } from '@tabler/icons-react'
import type { CatalogModel } from '@/services/models/types'
import { extractDescription, extractModelName, selectDefaultQuant } from '@/lib/models'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { Button } from '@/components/ui/button'

type FeaturedModelGridProps = {
  models: CatalogModel[]
  onOpenModel: (model: CatalogModel) => void
}

export function FeaturedModelGrid({ models, onOpenModel }: FeaturedModelGridProps) {
  if (!models.length) return null

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Featured</span>
        <span>{models.length}</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {models.map((model) => {
          const defaultQuant = model.is_mlx
            ? undefined
            : selectDefaultQuant(model.quants, DEFAULT_MODEL_QUANTIZATIONS)
          return (
            <article
              key={model.model_name}
              className="group flex min-h-40 flex-col rounded-lg border border-border/60 bg-card/70 p-3 transition-colors hover:border-border hover:bg-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3
                    className="truncate text-sm font-medium capitalize text-foreground"
                    title={extractModelName(model.model_name) ?? model.model_name}
                  >
                    {extractModelName(model.model_name) ?? model.model_name}
                  </h3>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {model.developer ?? 'Unknown'}
                  </div>
                </div>
                <span className="shrink-0 rounded bg-secondary/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {model.is_mlx ? 'MLX' : 'GGUF'}
                </span>
              </div>
              <div className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">
                <RenderMarkdown className="select-none reset-heading" content={extractDescription(model.description) || ''} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <IconDownload size={13} />
                  {model.downloads || 0}
                </span>
                {!model.is_mlx ? (
                  <span className="inline-flex items-center gap-1">
                    <IconFileCode size={13} />
                    {model.quants?.length || 0}
                  </span>
                ) : null}
                {(model.num_mmproj ?? 0) > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <IconEye size={13} />
                    Vision
                  </span>
                ) : null}
                {model.tools ? (
                  <span className="inline-flex items-center gap-1">
                    <IconTool size={13} />
                    Tools
                  </span>
                ) : null}
              </div>
              <div className="mt-auto flex items-center justify-between gap-3 pt-3">
                <span className="truncate text-xs text-muted-foreground">
                  {model.is_mlx ? 'Apple Silicon' : defaultQuant?.file_size ?? 'Variants'}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs opacity-80 group-hover:opacity-100"
                  onClick={() => onOpenModel(model)}
                >
                  Open
                </Button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
