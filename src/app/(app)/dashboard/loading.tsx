export default function DashboardLoading() {
  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-hidden px-6 py-8 space-y-6">
        {/* User bubble */}
        <div className="flex justify-end">
          <div className="skeleton h-10 w-48" />
        </div>
        {/* Assistant bubble */}
        <div className="space-y-2">
          <div className="skeleton h-4 w-72" />
          <div className="skeleton h-4 w-56" />
          <div className="skeleton h-4 w-64" />
        </div>
        {/* User bubble */}
        <div className="flex justify-end">
          <div className="skeleton h-10 w-36" />
        </div>
        {/* Assistant bubble */}
        <div className="space-y-2">
          <div className="skeleton h-4 w-80" />
          <div className="skeleton h-4 w-60" />
        </div>
      </div>

      {/* Input bar */}
      <div className="border-t border-border px-6 py-4">
        <div className="skeleton h-12 w-full" />
      </div>
    </div>
  )
}
