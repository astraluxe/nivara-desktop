// Prevents a console window from appearing on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Fix blank screen on Linux: disable WebKit DMA-buf renderer (causes white/blank window
    // on Ubuntu 22.04+ with Mesa drivers). Must be set before WebKit subprocess spawns.
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        // Also disable GPU compositing as a secondary fallback for Wayland/Mesa issues
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
    nivara_desktop_lib::run()
}
