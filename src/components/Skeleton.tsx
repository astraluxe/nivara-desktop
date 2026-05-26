export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-nv-surface2 rounded animate-pulse ${className}`} />
  );
}

export function AppSkeleton() {
  return (
    <div className="h-full flex flex-col bg-nv-bg">
      {/* Title bar skeleton */}
      <div className="h-9 border-b border-nv-border shrink-0 bg-nv-surface flex items-center px-4 gap-3">
        <Skeleton className="w-[18px] h-[16px] rounded-sm" />
        <Skeleton className="w-28 h-3 rounded" />
        <div className="flex-1" />
        <Skeleton className="w-4 h-4 rounded-sm" />
        <Skeleton className="w-4 h-4 rounded-sm" />
        <Skeleton className="w-4 h-4 rounded-sm" />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar skeleton */}
        <div className="w-[60px] shrink-0 border-r border-nv-border bg-nv-bg flex flex-col items-center py-3 gap-2">
          <Skeleton className="w-8 h-8 rounded-lg" />
          <div className="w-5 h-px bg-nv-border my-1" />
          {[0,1,2,3,4].map((i) => (
            <Skeleton key={i} className="w-8 h-8 rounded-lg" />
          ))}
          <div className="flex-1" />
          <Skeleton className="w-7 h-7 rounded-lg" />
          <Skeleton className="w-7 h-7 rounded-full" />
        </div>

        {/* Main content skeleton — mirrors Home layout */}
        <div className="flex-1 overflow-hidden p-8">
          <div className="max-w-[960px] mx-auto">
            <div className="mb-8">
              <Skeleton className="w-24 h-2.5 mb-3 rounded" />
              <Skeleton className="w-64 h-8 rounded" />
              <Skeleton className="w-48 h-4 mt-2 rounded" />
            </div>

            <div className="grid grid-cols-[272px_1fr] gap-5 mb-5">
              {/* Left column */}
              <div className="flex flex-col gap-4">
                <Skeleton className="h-44 rounded-2xl" />
                <Skeleton className="h-24 rounded-2xl" />
                <Skeleton className="h-32 rounded-2xl" />
              </div>
              {/* Right grid */}
              <div className="grid grid-cols-2 gap-4">
                {[0,1,2,3,4].map((i) => (
                  <Skeleton key={i} className="rounded-2xl min-h-[140px]" />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
