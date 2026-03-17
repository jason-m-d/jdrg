export default function ProjectsLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="skeleton h-5 w-24" />
        <div className="skeleton h-8 w-28" />
      </div>

      {/* Grid of card placeholders */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border border-border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="skeleton size-3 rounded-full" />
              <div className="skeleton h-4 w-32" />
            </div>
            <div className="skeleton h-3 w-48" />
            <div className="flex gap-4">
              <div className="skeleton h-3 w-16" />
              <div className="skeleton h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
