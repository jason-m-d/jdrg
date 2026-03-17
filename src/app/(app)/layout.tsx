import { AuthProvider } from '@/components/auth-provider'
import { Sidebar } from '@/components/sidebar'
import { MobileNav } from '@/components/mobile-nav'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="flex h-screen overflow-hidden">
        <div className="hidden md:flex">
          <Sidebar />
        </div>
        <main className="flex-1 overflow-auto pb-16 md:pb-0">
          {children}
        </main>
        <MobileNav />
      </div>
    </AuthProvider>
  )
}
