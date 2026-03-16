'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/auth-provider'
import { cn } from '@/lib/utils'
import {
  Home,
  FileText,
  FolderOpen,
  CheckSquare,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

const navItems = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/projects', label: 'Projects', icon: FolderOpen },
  { href: '/action-items', label: 'Action Items', icon: CheckSquare },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const { signOut } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [projects, setProjects] = useState<any[]>([])

  useEffect(() => {
    getSupabaseBrowser()
      .from('projects')
      .select('id, name, color')
      .order('name')
      .then(({ data }) => setProjects(data || []))
  }, [pathname])

  return (
    <div className={cn(
      "flex flex-col border-r border-border bg-background transition-all duration-200",
      collapsed ? "w-14" : "w-48"
    )}>
      {/* Logo */}
      <div className="flex items-center justify-between px-4 py-4">
        {!collapsed && (
          <Link href="/dashboard" className="text-sm font-semibold tracking-widest uppercase">
            J.DRG
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-2 space-y-0.5">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-sm transition-colors",
                isActive
                  ? "text-foreground font-medium border-l-2 border-foreground -ml-px"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon className="size-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          )
        })}

        {/* Projects */}
        {!collapsed && projects.length > 0 && (
          <div className="pt-6">
            <span className="px-3 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Projects
            </span>
            <div className="mt-2 space-y-0.5">
              {projects.map((project) => {
                const isActive = pathname === `/projects/${project.id}`
                return (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 text-xs transition-colors",
                      isActive
                        ? "text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <div
                      className="size-2 shrink-0"
                      style={{ backgroundColor: project.color || '#6B7280' }}
                    />
                    <span className="truncate">{project.name}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Sign out */}
      <div className="border-t border-border p-2">
        <button
          onClick={signOut}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="size-4" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </div>
  )
}
