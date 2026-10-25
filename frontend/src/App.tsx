import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { NarrowTopBar } from '@/components/sidebar/NarrowTopBar'
import { Statusbar } from '@/components/Statusbar'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Toaster } from '@/components/ui/sonner'
import { UpdateNotifier } from '@/components/UpdateNotifier'
import { AnnouncementsDialog } from '@/components/AnnouncementsDialog'
import { InstallBlockingOverlay } from '@/components/InstallBlockingOverlay'
import { useTauriBridge } from '@/hooks/useTauriBridge'
import { HAS_TAURI, invoke } from '@/lib/tauri'
import { useSidebar } from '@/hooks/useSidebar'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { cn } from '@/lib/utils'

export default function App() {
  useTauriBridge()
  const location = useLocation()
  const scale = useUiPrefsStore((s) => s.scale)
  const isOpen = useSidebar((s) => s.isOpen)
  const settings = useSidebar((s) => s.settings)
  const isPlayRoute = location.pathname === '/play'

  // Apply UI scale by adjusting :root font-size — the design system is
  // rem-based so this scales typography, spacing, icons, sidebar width
  // (w-[18rem] / w-[5.625rem]), and Radix portals uniformly.
  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * scale}px`
    return () => {
      document.documentElement.style.fontSize = ''
    }
  }, [scale])

  // When not on the `/play` route, park the embedded Chromium window off-canvas
  // inside `main_hwnd` (keeping WS_VISIBLE and non-zero size so WebGL / LayaAir
  // and CDP autoplay never pause).
  useEffect(() => {
    if (!HAS_TAURI || location.pathname === '/play') return
    const park = () => {
      const dpr = window.devicePixelRatio || 1
      void invoke('sync_embedded_browser', {
        active: false,
        x: 0,
        y: 0,
        width: Math.max(960, Math.round((window.innerWidth - 100) * dpr)),
        height: Math.max(600, Math.round((window.innerHeight - 80) * dpr)),
      }).catch(() => {})
    }
    park()
    const id = window.setInterval(park, 1000)
    return () => window.clearInterval(id)
  }, [location.pathname])

  return (
    <>
      {!isPlayRoute && <Sidebar />}
      <main
        className={cn(
          'h-screen flex flex-col min-w-0 overflow-hidden bg-background text-foreground transition-[margin-left] ease-in-out duration-300',
          // In the `/play` route, hide the sidebar completely and reclaim all space.
          // Otherwise, track pinned width only (hover expands as an overlay).
          isPlayRoute
            ? 'ml-0'
            : settings.disabled
              ? 'lg:ml-0'
              : isOpen
                ? 'lg:ml-[18rem]'
                : 'lg:ml-[5.625rem]',
        )}
      >
        {/* Below `lg` the sidebar is an off-screen drawer, so this is the
            only navigation entry point. Renders null when docked or in play view. */}
        {!isPlayRoute && <NarrowTopBar />}
        <div className="flex-1 overflow-auto">
          {/* Keyed by route so a crash on one page doesn't poison the others. */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
        <Statusbar />
      </main>
      <Toaster />
      <UpdateNotifier />
      <AnnouncementsDialog />
      <InstallBlockingOverlay />
    </>
  )
}
