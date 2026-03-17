'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Home, FileText, FolderKanban, Settings } from 'lucide-react'
import { useState, useEffect } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'

export function MobileNav() {
  const pathname = usePathname()
  const [projects, setProjects] = useState<any[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    function refresh() {
      const supabase = getSupabaseBrowser()
      supabase
        .from('projects')
        .select('id, name, color')
        .order('name')
        .then(({ data }) => setProjects(data || []))
    }

    refresh()
    window.addEventListener('projects-changed', refresh)
    return () => window.removeEventListener('projects-changed', refresh)
  }, [])

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/')

  const expertActive = pathname.startsWith('/projects/')

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden border-t border-sidebar-border bg-sidebar"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <Link
          href="/dashboard"
          className={cn(
            'flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors',
            isActive('/dashboard') ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          <Home className="size-5" />
          <span className="text-[0.5625rem] uppercase tracking-[0.1em]">Home</span>
        </Link>

        <Link
          href="/documents"
          className={cn(
            'flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors',
            isActive('/documents') ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          <FileText className="size-5" />
          <span className="text-[0.5625rem] uppercase tracking-[0.1em]">Docs</span>
        </Link>

        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerTrigger asChild>
            <button
              className={cn(
                'flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors',
                expertActive ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              <FolderKanban className="size-5" />
              <span className="text-[0.5625rem] uppercase tracking-[0.1em]">Experts</span>
            </button>
          </DrawerTrigger>
          <DrawerContent>
            <div className="px-4 pt-4 pb-2">
              <DrawerTitle className="text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground/50 font-medium">
                Experts
              </DrawerTitle>
            </div>
            <div className="px-2 pb-4 space-y-0.5 overflow-y-auto max-h-[60vh]">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  onClick={() => setDrawerOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 text-[0.8125rem] transition-colors',
                    pathname === `/projects/${project.id}`
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground'
                  )}
                >
                  <div
                    className="size-2.5 shrink-0"
                    style={{ backgroundColor: project.color || '#6B7280' }}
                  />
                  <span className="truncate">{project.name}</span>
                </Link>
              ))}
              {projects.length === 0 && (
                <p className="px-3 py-4 text-[0.75rem] text-muted-foreground/30 text-center">
                  No experts yet
                </p>
              )}
            </div>
            <div style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} />
          </DrawerContent>
        </Drawer>

        <Link
          href="/settings"
          className={cn(
            'flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors',
            isActive('/settings') ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          <Settings className="size-5" />
          <span className="text-[0.5625rem] uppercase tracking-[0.1em]">Settings</span>
        </Link>
      </nav>
    </>
  )
}
