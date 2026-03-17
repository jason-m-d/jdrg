export default function ActionItemsLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="skeleton h-5 w-32" />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border pb-px">
        {['Pending', 'Approved', 'Completed', 'Dismissed'].map((tab) => (
          <div key={tab} className="skeleton h-8 w-24" />
        ))}
      </div>

      {/* Card placeholders */}
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border border-border p-4 space-y-2">
            <div className="flex items-center gap-2">
              <div className="skeleton size-2 rounded-full" />
              <div className="skeleton h-4 w-56" />
            </div>
            <div className="skeleton h-3 w-72" />
            <div className="flex gap-3">
              <div className="skeleton h-3 w-16" />
              <div className="skeleton h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
