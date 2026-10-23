//! Win32 window embedding for the Chromium game client inside Akagi's `/play` tab.
//!
//! Why use an **Owned Top-Level Window (`GWLP_HWNDPARENT`) + `SetWindowRgn` +
//! Layered Alpha** instead of `SetParent` (`WS_CHILD`):
//! - In Win32, making a cross-process `Chrome_WidgetWin_1` window (`chrome.exe`)
//!   a `WS_CHILD` of `main_hwnd` (`akagi.exe`) prevents Windows from activating
//!   `chrome_hwnd` (`WM_ACTIVATE` / foreground thread queue focus) when clicked,
//!   which blocks keyboard and IME input in Mahjong Soul's login screen.
//! - By keeping `chrome_hwnd` as a top-level window owned by `main_hwnd`
//!   (`SetWindowLongPtrW(chrome_hwnd, GWLP_HWNDPARENT, main_hwnd)`), clicking
//!   inside the game area natively activates `chrome_hwnd` so keyboard typing,
//!   IME, copy/paste, and login inputs work 100% natively.
//! - `ClientToScreen` + `SetWindowRgn` crops away Chrome's 31px `--app` title bar
//!   and frame borders so only `Chrome_RenderWidgetHostHWND` fills the `/play`
//!   tab area seamlessly, and moves in real time with `main_hwnd`.
//! - When switching to another Akagi tab (`Overview`, `Game`, `Settings`, etc.)
//!   or when `main_hwnd` is minimized, we never call `SW_HIDE` or `SW_MINIMIZE`
//!   (which would throttle WebGL / `requestAnimationFrame`). Instead, we apply
//!   `WS_EX_LAYERED | WS_EX_TRANSPARENT` with `alpha = 0` (100% invisible and
//!   click-through), keeping `WS_VISIBLE` and full dimensions so background
//!   CDP autoplay never stops.

use crate::config::CaptureMode;
use crate::ipc::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tracing::info;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EmbeddedBrowserStatus {
    pub enabled: bool,
    pub embedded: bool,
    pub browser_found: bool,
}

struct EmbedInternalState {
    enabled: bool,
    main_hwnd: isize,
    chrome_hwnd: isize,
    orig_style: i32,
    orig_exstyle: i32,
    orig_rect: (i32, i32, i32, i32),
    last_client_rect: (i32, i32, i32, i32),
    last_active: bool,
    last_applied: Option<(bool, bool, i32, i32, i32, i32, (i32, i32, i32, i32))>,
    settle_ticks_remaining: u8,
    last_pid_scan: Option<Instant>,
}

impl Default for EmbedInternalState {
    fn default() -> Self {
        Self {
            enabled: true,
            main_hwnd: 0,
            chrome_hwnd: 0,
            orig_style: 0,
            orig_exstyle: 0,
            orig_rect: (100, 100, 1280, 760),
            last_client_rect: (0, 44, 1280, 720),
            last_active: false,
            last_applied: None,
            settle_ticks_remaining: 0,
            last_pid_scan: None,
        }
    }
}

static EMBED_STATE: LazyLock<Mutex<EmbedInternalState>> =
    LazyLock::new(|| Mutex::new(EmbedInternalState::default()));

#[cfg(windows)]
mod win32 {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    #[repr(C)]
    #[derive(Clone, Copy, Debug, Default)]
    pub struct RECT {
        pub left: i32,
        pub top: i32,
        pub right: i32,
        pub bottom: i32,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Debug, Default)]
    pub struct POINT {
        pub x: i32,
        pub y: i32,
    }

    pub const GWL_STYLE: i32 = -16;
    pub const GWL_EXSTYLE: i32 = -20;
    pub const GWLP_HWNDPARENT: i32 = -8;

    pub const WS_EX_TRANSPARENT: u32 = 0x0000_0020;
    pub const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
    pub const WS_EX_APPWINDOW: u32 = 0x0004_0000;
    pub const WS_EX_LAYERED: u32 = 0x0008_0000;
    pub const WS_EX_NOACTIVATE: u32 = 0x0800_0000;

    pub const LWA_ALPHA: u32 = 0x0000_0002;

    pub const HWND_TOP: isize = 0;

    pub const SW_RESTORE: i32 = 9;

    pub const SWP_NOZORDER: u32 = 0x0004;
    pub const SWP_NOACTIVATE: u32 = 0x0010;
    pub const SWP_FRAMECHANGED: u32 = 0x0020;
    pub const SWP_SHOWWINDOW: u32 = 0x0040;
    pub const SWP_NOOWNERZORDER: u32 = 0x0200;

    #[link(name = "user32")]
    extern "system" {
        pub fn IsWindow(hWnd: isize) -> i32;
        pub fn IsWindowVisible(hWnd: isize) -> i32;
        pub fn IsIconic(hWnd: isize) -> i32;
        pub fn IsZoomed(hWnd: isize) -> i32;
        pub fn ShowWindow(hWnd: isize, nCmdShow: i32) -> i32;
        pub fn GetForegroundWindow() -> isize;
        pub fn ClientToScreen(hWnd: isize, lpPoint: *mut POINT) -> i32;
        pub fn GetWindowLongW(hWnd: isize, nIndex: i32) -> i32;
        pub fn SetWindowLongW(hWnd: isize, nIndex: i32, dwNewLong: i32) -> i32;
        pub fn SetWindowLongPtrW(hWnd: isize, nIndex: i32, dwNewLong: isize) -> isize;
        pub fn SetLayeredWindowAttributes(
            hwnd: isize,
            crKey: u32,
            bAlpha: u8,
            dwFlags: u32,
        ) -> i32;
        pub fn GetWindowRect(hWnd: isize, lpRect: *mut RECT) -> i32;
        pub fn SetWindowPos(
            hWnd: isize,
            hWndInsertAfter: isize,
            X: i32,
            Y: i32,
            cx: i32,
            cy: i32,
            uFlags: u32,
        ) -> i32;
        pub fn EnumWindows(
            lpEnumFunc: extern "system" fn(isize, isize) -> i32,
            lParam: isize,
        ) -> i32;
        pub fn EnumChildWindows(
            hWndParent: isize,
            lpEnumFunc: extern "system" fn(isize, isize) -> i32,
            lParam: isize,
        ) -> i32;
        pub fn GetWindowThreadProcessId(hWnd: isize, lpdwProcessId: *mut u32) -> u32;
        pub fn GetClassNameW(hWnd: isize, lpClassName: *mut u16, nMaxCount: i32) -> i32;
        pub fn GetWindowTextLengthW(hWnd: isize) -> i32;
        pub fn SetWindowRgn(hWnd: isize, hRgn: isize, bRedraw: i32) -> i32;
    }

    #[link(name = "gdi32")]
    extern "system" {
        pub fn CreateRectRgn(x1: i32, y1: i32, x2: i32, y2: i32) -> isize;
    }

    pub fn get_class_name(hwnd: isize) -> String {
        let mut buf = [0u16; 256];
        let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        if len <= 0 {
            return String::new();
        }
        OsString::from_wide(&buf[..len as usize])
            .to_string_lossy()
            .into_owned()
    }

    struct FindTopCtx {
        target_pid: u32,
        found_hwnd: isize,
    }

    extern "system" fn enum_top_proc(hwnd: isize, lparam: isize) -> i32 {
        let ctx = unsafe { &mut *(lparam as *mut FindTopCtx) };
        unsafe {
            if IsWindowVisible(hwnd) == 0 {
                return 1;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid != ctx.target_pid {
                return 1;
            }
            if GetWindowTextLengthW(hwnd) <= 0 {
                return 1;
            }
            if get_class_name(hwnd) == "Chrome_WidgetWin_1" {
                ctx.found_hwnd = hwnd;
                return 0; // stop enumeration
            }
        }
        1
    }

    pub fn find_chrome_top_window(target_pid: u32) -> Option<isize> {
        let mut ctx = FindTopCtx {
            target_pid,
            found_hwnd: 0,
        };
        unsafe {
            EnumWindows(enum_top_proc, (&mut ctx as *mut FindTopCtx) as isize);
        }
        if ctx.found_hwnd != 0 {
            Some(ctx.found_hwnd)
        } else {
            None
        }
    }

    struct FindRenderCtx {
        found_rect: Option<RECT>,
    }

    extern "system" fn enum_child_render_proc(hwnd: isize, lparam: isize) -> i32 {
        let ctx = unsafe { &mut *(lparam as *mut FindRenderCtx) };
        if get_class_name(hwnd) == "Chrome_RenderWidgetHostHWND" {
            let mut r = RECT::default();
            if unsafe { GetWindowRect(hwnd, &mut r) } != 0 {
                ctx.found_rect = Some(r);
                return 0;
            }
        }
        1
    }

    /// Measure `(left, top, right, bottom)` pixel insets from `chrome_hwnd` to
    /// its inner `Chrome_RenderWidgetHostHWND` web viewport.
    pub fn measure_render_insets(chrome_hwnd: isize) -> (i32, i32, i32, i32) {
        let mut win_rect = RECT::default();
        if unsafe { GetWindowRect(chrome_hwnd, &mut win_rect) } == 0 {
            return (8, 31, 7, 7);
        }
        let mut ctx = FindRenderCtx { found_rect: None };
        unsafe {
            EnumChildWindows(
                chrome_hwnd,
                enum_child_render_proc,
                (&mut ctx as *mut FindRenderCtx) as isize,
            );
        }
        if let Some(rr) = ctx.found_rect {
            let left = rr.left - win_rect.left;
            let top = rr.top - win_rect.top;
            let right = win_rect.right - rr.right;
            let bottom = win_rect.bottom - rr.bottom;
            if (0..=40).contains(&left)
                && (0..=120).contains(&top)
                && (0..=40).contains(&right)
                && (0..=40).contains(&bottom)
            {
                return (left, top, right, bottom);
            }
        }
        (8, 31, 7, 7)
    }

    pub fn apply_window_placement(st: &mut super::EmbedInternalState, force: bool) -> bool {
        let main_hwnd = st.main_hwnd;
        let hwnd = st.chrome_hwnd;
        if main_hwnd == 0 || hwnd == 0 {
            return false;
        }
        unsafe {
            if IsWindow(hwnd) == 0 {
                st.chrome_hwnd = 0;
                st.last_applied = None;
                return false;
            }
            if IsZoomed(hwnd) != 0 || IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
        }

        let host_minimized = unsafe { IsIconic(main_hwnd) != 0 };
        let visible_on_tab = st.last_active && !host_minimized;

        let (cx, cy, cw, ch) = st.last_client_rect;
        let w = cw.max(640);
        let h = ch.max(360);

        let mut pt = POINT { x: cx, y: cy };
        if !host_minimized {
            unsafe {
                ClientToScreen(main_hwnd, &mut pt);
            }
        } else {
            pt = POINT { x: 100, y: 100 };
        }

        let insets = measure_render_insets(hwnd);
        let (left_inset, top_inset, right_inset, bottom_inset) = insets;
        let win_x = pt.x - left_inset;
        let win_y = pt.y - top_inset;
        let win_w = w + left_inset + right_inset;
        let win_h = h + top_inset + bottom_inset;

        let target = (
            visible_on_tab,
            host_minimized,
            win_x,
            win_y,
            win_w,
            win_h,
            insets,
        );
        let mut size_changed = false;
        if let Some((_, _, _, _, prev_w, prev_h, _)) = st.last_applied {
            if prev_w != win_w || prev_h != win_h {
                size_changed = true;
            }
        } else {
            size_changed = true;
        }

        if !force && st.last_applied == Some(target) && st.settle_ticks_remaining == 0 {
            return false;
        }
        if st.settle_ticks_remaining > 0 {
            st.settle_ticks_remaining -= 1;
        }

        unsafe {
            let base_ex = (st.orig_exstyle as u32) & !WS_EX_APPWINDOW;
            if visible_on_tab {
                // Owned by main_hwnd so it stays directly above main_hwnd,
                // opaque and fully interactive (native keyboard & IME focus).
                SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, main_hwnd);
                let ex = (base_ex | WS_EX_LAYERED | WS_EX_TOOLWINDOW)
                    & !(WS_EX_TRANSPARENT | WS_EX_NOACTIVATE);
                SetWindowLongW(hwnd, GWL_EXSTYLE, ex as i32);
                SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);
            } else {
                // When user is on another Akagi tab or Akagi is minimized:
                // keep WS_VISIBLE and full size so WebGL / LayaAir / CDP autoplay
                // never throttle, but make the window 100% transparent and
                // click-through.
                if host_minimized {
                    SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, 0);
                } else {
                    SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, main_hwnd);
                }
                let ex =
                    base_ex | WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE;
                SetWindowLongW(hwnd, GWL_EXSTYLE, ex as i32);
                SetLayeredWindowAttributes(hwnd, 0, 0, LWA_ALPHA);
            }

            let fg = GetForegroundWindow();
            let our_app_fg = fg == main_hwnd || fg == hwnd;
            let z_flags = if visible_on_tab && our_app_fg {
                SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOOWNERZORDER
            } else {
                SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOOWNERZORDER
            };

            SetWindowPos(hwnd, HWND_TOP, win_x, win_y, win_w, win_h, z_flags);
            let rgn = CreateRectRgn(left_inset, top_inset, left_inset + w, top_inset + h);
            if rgn != 0 {
                SetWindowRgn(hwnd, rgn, 1);
            }
        }

        st.last_applied = Some(target);
        tracing::debug!(
            "embed: placed hwnd={hwnd} visible={visible_on_tab} pos=({win_x},{win_y}) size=({win_w}x{win_h}) insets={insets:?}"
        );
        size_changed
    }

    pub fn detach_window(st: &mut super::EmbedInternalState) {
        let hwnd = st.chrome_hwnd;
        if hwnd == 0 {
            return;
        }
        st.chrome_hwnd = 0;
        st.last_applied = None;
        st.settle_ticks_remaining = 0;
        unsafe {
            if IsWindow(hwnd) == 0 {
                return;
            }
            SetWindowRgn(hwnd, 0, 1);
            SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, 0);
            if st.orig_style != 0 {
                SetWindowLongW(hwnd, GWL_STYLE, st.orig_style);
            }
            if st.orig_exstyle != 0 {
                SetWindowLongW(hwnd, GWL_EXSTYLE, st.orig_exstyle);
            }
            SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);
            let (ox, oy, ow, oh) = st.orig_rect;
            let w = ow.max(1100);
            let h = oh.max(720);
            SetWindowPos(
                hwnd,
                HWND_TOP,
                ox.max(40),
                oy.max(40),
                w,
                h,
                SWP_FRAMECHANGED | SWP_SHOWWINDOW,
            );
        }
        tracing::info!("embed: detached chromium window hwnd={hwnd} back to desktop");
    }
}

/// Called from `main.on_window_event` when the main Akagi window moves or resizes
/// so the owned game window follows with zero latency.
pub fn on_host_window_moved() {
    #[cfg(windows)]
    {
        if let Ok(mut st) = EMBED_STATE.lock() {
            if st.enabled && st.chrome_hwnd != 0 {
                let _ = win32::apply_window_placement(&mut st, false);
            }
        }
    }
}

/// Detach any embedded browser window before Akagi's main window exits.
pub fn detach_on_exit() {
    #[cfg(windows)]
    {
        if let Ok(mut st) = EMBED_STATE.lock() {
            win32::detach_window(&mut st);
        }
    }
}

#[cfg(windows)]
fn sync_impl(
    main_hwnd: isize,
    profile_dir: &Path,
    capture_is_chromium: bool,
    active: bool,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> (EmbeddedBrowserStatus, bool) {
    use win32::*;

    let mut st = match EMBED_STATE.lock() {
        Ok(g) => g,
        Err(_) => {
            return (
                EmbeddedBrowserStatus {
                    enabled: true,
                    embedded: false,
                    browser_found: false,
                },
                false,
            )
        }
    };

    st.main_hwnd = main_hwnd;
    st.last_active = active;
    if width >= 320 && height >= 240 {
        st.last_client_rect = (x, y, width, height);
    }

    if !st.enabled || !capture_is_chromium {
        let had = st.chrome_hwnd != 0;
        detach_window(&mut st);
        return (
            EmbeddedBrowserStatus {
                enabled: st.enabled,
                embedded: false,
                browser_found: false,
            },
            had,
        );
    }

    if st.chrome_hwnd != 0 && unsafe { IsWindow(st.chrome_hwnd) } == 0 {
        st.chrome_hwnd = 0;
        st.last_applied = None;
        st.settle_ticks_remaining = 0;
    }

    let mut just_attached = false;
    if st.chrome_hwnd == 0 {
        let now = Instant::now();
        let should_scan = st
            .last_pid_scan
            .map(|t| now.duration_since(t) >= Duration::from_millis(800))
            .unwrap_or(true);
        if should_scan {
            st.last_pid_scan = Some(now);
            if let Some(pid) =
                crate::capture::chromium::profile::find_controlled_browser_pid(profile_dir)
            {
                if let Some(hwnd) = find_chrome_top_window(pid) {
                    unsafe {
                        if IsZoomed(hwnd) != 0 || IsIconic(hwnd) != 0 {
                            ShowWindow(hwnd, SW_RESTORE);
                        }
                        let mut r = RECT::default();
                        if GetWindowRect(hwnd, &mut r) != 0 {
                            st.orig_rect = (r.left, r.top, r.right - r.left, r.bottom - r.top);
                        }
                        st.orig_style = GetWindowLongW(hwnd, GWL_STYLE);
                        st.orig_exstyle = GetWindowLongW(hwnd, GWL_EXSTYLE);
                    }
                    st.chrome_hwnd = hwnd;
                    st.last_applied = None;
                    st.settle_ticks_remaining = 3;
                    just_attached = true;
                    info!("embed: attached controlled chromium window hwnd={hwnd} (pid={pid})");
                }
            }
        }
    }

    if st.chrome_hwnd == 0 {
        return (
            EmbeddedBrowserStatus {
                enabled: st.enabled,
                embedded: false,
                browser_found: false,
            },
            false,
        );
    }

    let size_changed = apply_window_placement(&mut st, just_attached) || just_attached;
    (
        EmbeddedBrowserStatus {
            enabled: st.enabled,
            embedded: true,
            browser_found: true,
        },
        size_changed,
    )
}

#[tauri::command]
pub async fn sync_embedded_browser(
    active: bool,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<EmbeddedBrowserStatus, String> {
    #[cfg(not(windows))]
    {
        let _ = (active, x, y, width, height, app, state);
        Ok(EmbeddedBrowserStatus {
            enabled: false,
            embedded: false,
            browser_found: false,
        })
    }
    #[cfg(windows)]
    {
        let main_win = app
            .get_webview_window("main")
            .ok_or_else(|| "main window not found".to_string())?;
        let main_hwnd = main_win.hwnd().map_err(|e| e.to_string())?.0 as isize;

        let (capture_mode, user_data_dir) = {
            let cfg = state.config.read().await;
            (
                cfg.capture.mode.clone(),
                cfg.capture.chromium.user_data_dir.clone(),
            )
        };
        let profile_dir =
            crate::capture::chromium::profile::resolve_profile_dir(&user_data_dir)
                .map_err(|e| e.to_string())?;
        let capture_is_chromium = capture_mode == CaptureMode::Chromium;

        let (status, size_changed) = tokio::task::spawn_blocking(move || {
            sync_impl(
                main_hwnd,
                &profile_dir,
                capture_is_chromium,
                active,
                x,
                y,
                width,
                height,
            )
        })
        .await
        .map_err(|e| format!("sync_embedded_browser join: {e}"))?;

        if size_changed {
            *state.autoplay_context.canvas_rect.write().await = None;
        }
        Ok(status)
    }
}

#[tauri::command]
pub async fn set_embedded_browser_enabled(
    enabled: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<EmbeddedBrowserStatus, String> {
    if let Ok(mut st) = EMBED_STATE.lock() {
        st.enabled = enabled;
        #[cfg(windows)]
        if !enabled {
            win32::detach_window(&mut st);
        }
    }
    *state.autoplay_context.canvas_rect.write().await = None;
    sync_embedded_browser(enabled, 0, 44, 1280, 720, app, state).await
}

#[tauri::command]
pub async fn reload_embedded_browser(state: State<'_, AppState>) -> Result<(), String> {
    let page_guard = state.autoplay_context.page.read().await;
    if let Some(page) = page_guard.as_ref().cloned() {
        drop(page_guard);
        page.reload().await.map_err(|e| e.to_string())?;
        *state.autoplay_context.canvas_rect.write().await = None;
        Ok(())
    } else {
        Err("No active game browser page connected via CDP".to_string())
    }
}
