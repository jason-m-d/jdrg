export default function DocumentsLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="skeleton h-5 w-28" />
        <div className="flex gap-2">
          <div className="skeleton h-8 w-24" />
          <div className="skeleton h-8 w-24" />
        </div>
      </div>

      {/* Search / filter bar */}
      <div className="flex gap-3">
        <div className="skeleton h-9 flex-1" />
        <div className="skeleton h-9 w-28" />
        <div className="skeleton h-9 w-28" />
      </div>

      {/* List row placeholders */}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border border-border px-4 py-3">
            <div className="skeleton size-8" />
            <div className="flex-1 space-y-1.5">
              <div className="skeleton h-4 w-48" />
              <div className="skeleton h-3 w-24" />
            </div>
            <div className="skeleton h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}
