export default function ChatLoading() {
  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-4 border-b border-border px-6 py-3">
        <div className="skeleton h-4 w-12" />
        <div className="w-px h-4 bg-border" />
        <div className="skeleton h-4 w-32" />
        <div className="w-px h-4 bg-border" />
        <div className="skeleton h-4 w-20" />
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-hidden px-6 py-8 space-y-6">
        <div className="flex justify-end">
          <div className="skeleton h-10 w-48" />
        </div>
        <div className="space-y-2">
          <div className="skeleton h-4 w-72" />
          <div className="skeleton h-4 w-56" />
          <div className="skeleton h-4 w-64" />
        </div>
        <div className="flex justify-end">
          <div className="skeleton h-10 w-36" />
        </div>
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
