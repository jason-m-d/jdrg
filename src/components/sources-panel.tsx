'use client'

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ExternalLink } from 'lucide-react'

export interface Citation {
  url: string
  title: string
  snippet: string
  domain: string
}

interface SourcesPanelProps {
  open: boolean
  onClose: () => void
  citations: Citation[]
}

function FaviconIcon({ domain }: { domain: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
      alt=""
      className="size-4 rounded-sm shrink-0"
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )
}

export function SourcesPanel({ open, onClose, citations }: SourcesPanelProps) {
  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent side="right" className="w-80 sm:w-96 flex flex-col gap-0 p-0">
        <SheetHeader className="px-5 py-4 border-b border-border/50">
          <SheetTitle className="text-sm font-medium">
            Sources <span className="text-muted-foreground/50 font-normal">({citations.length})</span>
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto divide-y divide-border/30">
          {citations.map((c, i) => (
            <a
              key={i}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 px-5 py-4 hover:bg-muted/30 transition-colors group"
            >
              <FaviconIcon domain={c.domain} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[0.7rem] font-medium text-muted-foreground/70 uppercase tracking-wide truncate">
                    {c.domain}
                  </span>
                  <ExternalLink className="size-2.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
                </div>
                {c.title && c.title !== c.domain && (
                  <p className="mt-0.5 text-[0.8125rem] text-foreground/80 leading-snug line-clamp-2">
                    {c.title}
                  </p>
                )}
                {c.snippet && (
                  <p className="mt-1 text-[0.75rem] text-muted-foreground/50 leading-relaxed line-clamp-2">
                    {c.snippet}
                  </p>
                )}
              </div>
            </a>
          ))}
          {citations.length === 0 && (
            <div className="px-5 py-8 text-center text-[0.8125rem] text-muted-foreground/40">
              No sources available.
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Compact domain chips shown inline below a message */
export function CitationChips({ citations, onShowAll }: { citations: Citation[]; onShowAll: () => void }) {
  if (!citations.length) return null
  const visible = citations.slice(0, 2)
  const overflow = citations.length - visible.length

  return (
    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
      {visible.map((c, i) => (
        <a
          key={i}
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[0.6875rem] bg-muted/50 text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <FaviconIcon domain={c.domain} />
          {c.domain}
        </a>
      ))}
      {overflow > 0 && (
        <button
          onClick={onShowAll}
          className="inline-flex items-center px-2 py-0.5 rounded text-[0.6875rem] bg-muted/50 text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-colors"
        >
          +{overflow} more
        </button>
      )}
    </div>
  )
}

/** "X sources" button for the message action row */
export function SourcesButton({ citations, onClick }: { citations: Citation[]; onClick: () => void }) {
  if (!citations.length) return null
  const previews = citations.slice(0, 3)

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-[0.625rem] tracking-wide uppercase text-muted-foreground/40 hover:text-muted-foreground transition-colors"
    >
      <div className="flex items-center -space-x-0.5">
        {previews.map((c, i) => (
          <FaviconIcon key={i} domain={c.domain} />
        ))}
      </div>
      {citations.length} source{citations.length !== 1 ? 's' : ''}
    </button>
  )
}
