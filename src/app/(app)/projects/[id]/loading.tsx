export default function ProjectLoading() {
  return (
    <div className="flex h-full">
      {/* Left panel — conversation list */}
      <div className="w-56 border-r border-border p-4 space-y-3">
        <div className="skeleton h-4 w-28" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-8 w-full" />
          ))}
        </div>
      </div>

      {/* Center — message area + input */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-hidden px-6 py-8 space-y-6">
          <div className="flex justify-end">
            <div className="skeleton h-10 w-48" />
          </div>
          <div className="space-y-2">
            <div className="skeleton h-4 w-72" />
            <div className="skeleton h-4 w-56" />
          </div>
          <div className="flex justify-end">
            <div className="skeleton h-10 w-36" />
          </div>
          <div className="space-y-2">
            <div className="skeleton h-4 w-80" />
            <div className="skeleton h-4 w-60" />
          </div>
        </div>
        <div className="border-t border-border px-6 py-4">
          <div className="skeleton h-12 w-full" />
        </div>
      </div>
    </div>
  )
}
