use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

// ─── OAuth ───────────────────────────────────────────────────────────────────

// Stores JSON: {"code":"..."} (PKCE) or {"access_token":"...","refresh_token":"..."} (implicit)
static OAUTH_CODE: Mutex<Option<String>> = Mutex::new(None);

// Served at /callback — JS extracts both query params and hash fragment, then POSTs to /code.
// This covers PKCE flow (?code=) and implicit flow (#access_token=) equally.
const CALLBACK_HTML: &str = r##"<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>adris.tech</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#09090b;color:#fafafa;
  display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
.logo{margin-bottom:20px}
h2{font-size:1rem;font-weight:500}
.sub{color:#71717a;font-size:.8rem;margin-top:8px}
.dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:#7C5CFF;
  margin:0 2px;animation:b 1s infinite}
.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
@keyframes b{0%,80%,100%{opacity:.2}40%{opacity:1}}
</style></head>
<body><div>
<svg class="logo" width="36" height="32" viewBox="0 0 26 24" fill="none">
  <path d="M2 4 L9 4 L15 12 L9 20 L2 20 L8 12 Z" fill="#7C5CFF"/>
  <path d="M12 4 L19 4 L25 12 L19 20 L12 20 L18 12 Z" fill="#7C5CFF" opacity=".6"/>
</svg>
<h2 id="m"><span class="dot"></span><span class="dot"></span><span class="dot"></span></h2>
<p class="sub" id="s">Completing sign-in…</p>
</div>
<script>
(function(){
  var q=new URLSearchParams(location.search);
  var h=new URLSearchParams(location.hash.slice(1));
  var err=q.get('error')||h.get('error');
  if(err){
    var desc=q.get('error_description')||h.get('error_description')||err;
    document.getElementById('m').textContent='Sign-in failed.';
    document.getElementById('s').textContent=desc;
    // Notify the app so it can show the error and reset instead of waiting 3 minutes
    fetch('http://localhost:54321/code',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({error:desc,code:null,access_token:null,refresh_token:null})});
    return;
  }
  var payload=JSON.stringify({
    code:q.get('code')||h.get('code')||null,
    access_token:q.get('access_token')||h.get('access_token')||null,
    refresh_token:q.get('refresh_token')||h.get('refresh_token')||null
  });
  fetch('http://localhost:54321/code',{method:'POST',headers:{'Content-Type':'application/json'},body:payload})
    .then(function(){
      document.getElementById('m').textContent='Signed in to adris.tech.';
      document.getElementById('s').textContent='You can close this tab and return to the app.';
    })
    .catch(function(){
      document.getElementById('m').textContent='Signed in.';
      document.getElementById('s').textContent='You can close this tab and return to the app.';
    });
})();
</script></body></html>"##;

fn pct_decode(s: &str) -> String {
    let mut out = Vec::<u8>::new();
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hi = (b[i + 1] as char).to_digit(16);
            let lo = (b[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        } else if b[i] == b'+' {
            out.push(b' ');
            i += 1;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
fn start_oauth_server(app: tauri::AppHandle) -> Result<(), String> {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    *OAUTH_CODE.lock().unwrap() = None;

    // Bind synchronously — port must be ready BEFORE the caller opens the browser.
    // Binding inside the spawned thread causes a race: the OAuth redirect can arrive
    // before the thread runs, giving ERR_CONNECTION_REFUSED in the browser.
    let listener = TcpListener::bind("127.0.0.1:54321")
        .map_err(|_| "Port 54321 is already in use. Restart the app and try again.".to_string())?;

    let app_handle = app.clone();
    std::thread::spawn(move || {
        // Non-blocking so the deadline check doesn't hang inside accept().
        listener.set_nonblocking(true).ok();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
        loop {
            if std::time::Instant::now() > deadline { break; }

            let (mut stream, _) = match listener.accept() {
                Ok(pair) => pair,
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    continue;
                }
                Err(_) => break,
            };
            stream.set_nonblocking(false).ok();
            // Read the full HTTP request — body may arrive in a second TCP packet,
            // so we loop until Content-Length bytes of body have been received.
            let mut raw: Vec<u8> = Vec::with_capacity(8192);
            let mut tmp = [0u8; 8192];
            let req = loop {
                match stream.read(&mut tmp) {
                    Ok(0) | Err(_) => break String::from_utf8_lossy(&raw).into_owned(),
                    Ok(n) => raw.extend_from_slice(&tmp[..n]),
                }
                let s = String::from_utf8_lossy(&raw);
                if let Some(sep) = s.find("\r\n\r\n") {
                    let cl: usize = s[..sep].lines()
                        .find(|l| l.to_lowercase().starts_with("content-length:"))
                        .and_then(|l| l.splitn(2, ':').nth(1))
                        .and_then(|v| v.trim().parse().ok())
                        .unwrap_or(0);
                    if raw.len() >= sep + 4 + cl { break s.into_owned(); }
                    // body not fully arrived yet — read more
                } else if raw.len() > 65536 {
                    break s.into_owned(); // safety cap
                }
            };
            let first_line = req.lines().next().unwrap_or("").to_string();
            let method_path: Vec<&str> = first_line.splitn(3, ' ').collect();
            let method = method_path.get(0).copied().unwrap_or("");
            let path   = method_path.get(1).copied().unwrap_or("");

            const CORS: &str = "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, GET, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\n";
            if method == "OPTIONS" {
                let _ = stream.write_all(format!("HTTP/1.1 204 No Content\r\n{}Content-Length: 0\r\nConnection: close\r\n\r\n", CORS).as_bytes());
            } else if method == "POST" && path.starts_with("/code") {
                if let Some(sep) = req.find("\r\n\r\n") {
                    let body = req[sep + 4..].trim().to_string();
                    if !body.is_empty() {
                        *OAUTH_CODE.lock().unwrap() = Some(body.clone());
                        let _ = app_handle.emit("oauth_complete", body);
                    }
                }
                let _ = stream.write_all(format!("HTTP/1.1 200 OK\r\n{}Content-Length: 0\r\nConnection: close\r\n\r\n", CORS).as_bytes());
                break;
            } else if path.starts_with("/callback") || path == "/" {
                // PKCE flow: extract ?code= from GET URL directly.
                // Implicit flow (#access_token=) is client-side only; CALLBACK_HTML JS handles it.
                if let Some(qs_start) = path.find('?') {
                    for param in path[qs_start + 1..].split('&') {
                        if let Some(raw) = param.strip_prefix("code=") {
                            if !raw.is_empty() {
                                let code = pct_decode(raw);
                                let payload = format!(
                                    r#"{{"code":"{}","access_token":null,"refresh_token":null}}"#,
                                    code.replace('"', "\\\"")
                                );
                                *OAUTH_CODE.lock().unwrap() = Some(payload.clone());
                                let _ = app_handle.emit("oauth_complete", payload);
                            }
                            break;
                        }
                    }
                }
                let _ = stream.write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\n{}Content-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        CORS, CALLBACK_HTML.len(), CALLBACK_HTML
                    ).as_bytes()
                );
            } else {
                let _ = stream.write_all(format!("HTTP/1.1 204 No Content\r\n{}Content-Length: 0\r\nConnection: close\r\n\r\n", CORS).as_bytes());
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn poll_oauth_code() -> Option<String> {
    OAUTH_CODE.lock().unwrap().take()
}

// ─── PTY ─────────────────────────────────────────────────────────────────────

use portable_pty::{CommandBuilder, NativePtySystem, PtyPair, PtySize, PtySystem};

struct PtySession {
    writer: Box<dyn std::io::Write + Send>,
    child:  Box<dyn portable_pty::Child + Send + Sync>,
    pair:   PtyPair,
}

type PtyMap = Arc<Mutex<HashMap<u32, PtySession>>>;

fn pty_map_state() -> PtyMap {
    Arc::new(Mutex::new(HashMap::new()))
}

#[tauri::command]
fn pty_spawn(
    app: tauri::AppHandle,
    state: tauri::State<PtyMap>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let pty_system = NativePtySystem::default();
    let pair = pty_system.openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let mut cmd = {
        #[cfg(target_os = "windows")]
        { CommandBuilder::new("cmd.exe") }
        #[cfg(not(target_os = "windows"))]
        {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
            CommandBuilder::new(shell)
        }
    };
    cmd.cwd(&cwd);

    use std::io::Read;
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let id: u32 = {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().subsec_nanos()
    };

    let app2 = app.clone();
    let id2   = id;
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let s = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app2.emit("pty-data", (id2, s));
                }
            }
        }
    });

    state.lock().unwrap().insert(id, PtySession { writer, child, pair });
    Ok(id)
}

#[tauri::command]
fn pty_write(state: tauri::State<PtyMap>, id: u32, data: String) -> Result<(), String> {
    use std::io::Write;
    let mut map = state.lock().unwrap();
    let sess = map.get_mut(&id).ok_or("PTY not found")?;
    sess.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(state: tauri::State<PtyMap>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let map = state.lock().unwrap();
    let sess = map.get(&id).ok_or("PTY not found")?;
    sess.pair.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_kill(state: tauri::State<PtyMap>, id: u32) -> Result<(), String> {
    let mut map = state.lock().unwrap();
    if let Some(mut sess) = map.remove(&id) {
        let _ = sess.child.kill();
    }
    Ok(())
}

// ─── File system ─────────────────────────────────────────────────────────────

use serde::Serialize;

#[derive(Serialize)]
struct FileEntry { name: String, path: String, is_dir: bool }

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<FileEntry>, String> {
    use std::fs;
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for entry in entries.flatten() {
        let p    = entry.path();
        let meta = entry.metadata().ok();
        let is_dir = meta.map(|m| m.is_dir()).unwrap_or(false);
        // skip hidden files and common noise directories
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }
        if is_dir && matches!(name.as_str(), "node_modules" | "target" | ".git" | "dist" | ".next" | "out") { continue; }
        result.push(FileEntry { name, path: p.to_string_lossy().to_string(), is_dir });
    }
    Ok(result)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

// Read any file as base64 — used by the Brain's PDF viewer (pdf.js needs the raw bytes) and
// anywhere the frontend must load a binary local file it can't read directly.
#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(general_purpose::STANDARD.encode(&bytes))
}

// Copy a picked file INTO the app's own storage (<appdata>/brain-files) and return the new
// path. The Brain then references this durable copy — so a PDF stays viewable in the Brain
// even after the user deletes the original from their Desktop.
#[tauri::command]
fn brain_store_file(app: tauri::AppHandle, source_path: String) -> Result<String, String> {
    use tauri::Manager;
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?.join("brain-files");
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let src = std::path::Path::new(&source_path);
    let stem: String = src.file_stem().and_then(|s| s.to_str()).unwrap_or("file")
        .chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let stem = if stem.trim_matches('-').is_empty() { "file".to_string() } else { stem };
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("bin");
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
    let dest = base.join(format!("{}-{}.{}", &stem[..stem.len().min(40)], ts, ext));
    std::fs::copy(src, &dest).map_err(|e| format!("Couldn't save file into the Brain: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

// Save a picture (base64 bytes from the browser — e.g. an image the user dropped into the
// chat) into the app's own storage under brain-files/pictures, with a clean, human name.
// Returns the new path; the Brain references this durable copy so decks/notes can reuse it.
#[tauri::command]
fn brain_store_image(app: tauri::AppHandle, name: String, data_base64: String, ext: String) -> Result<String, String> {
    use tauri::Manager;
    use base64::{Engine as _, engine::general_purpose};
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?.join("brain-files").join("pictures");
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    // Clean the name into a safe file stem.
    let stem: String = name.trim().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let stem = stem.trim_matches('-').to_string();
    let stem = if stem.is_empty() { "image".to_string() } else { stem };
    let ext = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    let ext = if ext.is_empty() || ext.len() > 5 { "png".to_string() } else { ext };
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
    let bytes = general_purpose::STANDARD.decode(data_base64.trim())
        .map_err(|e| format!("Couldn't decode the image: {}", e))?;
    let dest = base.join(format!("{}-{}.{}", &stem[..stem.len().min(48)], ts, ext));
    std::fs::write(&dest, &bytes).map_err(|e| format!("Couldn't save the picture: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

// Save arbitrary bytes (base64 from the webview — e.g. a generated PDF) straight into the
// user's real Downloads folder. The old flow used an in-page <a download> click on a blob URL,
// which WebView2 on Windows silently ignores — so "Download PDF" did nothing. Writing the file
// natively here always lands a real file the user can find, and returns its path so the UI can
// say "Saved to Downloads" and offer to open it. Auto-suffixes "(2)", "(3)"… so it never
// clobbers an earlier download of the same name.
#[tauri::command]
fn save_to_downloads(app: tauri::AppHandle, filename: String, data_base64: String) -> Result<String, String> {
    use tauri::Manager;
    use base64::{Engine as _, engine::general_purpose};
    let dir = app.path().download_dir()
        .or_else(|_| app.path().home_dir().map(|h| h.join("Downloads")))
        .map_err(|e| format!("Couldn't find your Downloads folder: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Sanitise the requested name; keep its extension.
    let p = std::path::Path::new(&filename);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("pdf").to_string();
    let stem: String = p.file_stem().and_then(|s| s.to_str()).unwrap_or("download")
        .chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect();
    let stem = { let s = stem.trim_matches('-').to_string(); if s.is_empty() { "download".to_string() } else { s } };
    let bytes = general_purpose::STANDARD.decode(data_base64.trim())
        .map_err(|e| format!("Couldn't decode the file: {}", e))?;
    let mut dest = dir.join(format!("{}.{}", stem, ext));
    let mut n = 2;
    while dest.exists() {
        dest = dir.join(format!("{} ({}).{}", stem, n, ext));
        n += 1;
        if n > 200 { break; }
    }
    std::fs::write(&dest, &bytes).map_err(|e| format!("Couldn't save to Downloads: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

// ─── Brain: extract readable text from any file ──────────────────────────────
// The Brain lets users drop in real documents. Plain-text files (csv, txt, md,
// json, code…) read directly; office/binary formats (PDF, PPTX, DOCX, XLSX/XLS/
// ODS) are parsed into plain text the agents can actually read. All deps are pure
// Rust (calamine, pdf-extract, quick-xml, zip) so it behaves identically on
// Windows and Linux. Returns the extracted text (capped) or a clear error.
#[tauri::command]
fn brain_extract_text(path: String) -> Result<String, String> {
    let ext = std::path::Path::new(&path)
        .extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let text = match ext.as_str() {
        "pdf"                                          => extract_pdf_text(&path)?,
        "xlsx" | "xls" | "xlsm" | "xlsb" | "ods"       => extract_spreadsheet_text(&path)?,
        "pptx"                                         => extract_ooxml_text(&path, "ppt/slides/slide")?,
        "docx"                                         => extract_ooxml_text(&path, "word/document")?,
        // csv / tsv / txt / md / json / code / anything else → read as (lossy) UTF-8.
        _ => {
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            String::from_utf8_lossy(&bytes).to_string()
        }
    };
    // Cap so a truly enormous file can't hang the UI, but keep it high enough that a big
    // spreadsheet (e.g. a 1200-row vendor master) comes through COMPLETE instead of being cut
    // off partway — the earlier 200k cap silently dropped the back half of large tables.
    const CAP: usize = 2_000_000;
    if text.chars().count() > CAP {
        Ok(text.chars().take(CAP).collect())
    } else {
        Ok(text)
    }
}

// Size on disk of a stored file, in bytes — shown in the Brain so the user can see how much
// storage each attached file/picture is using.
#[tauri::command]
fn file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path).map(|m| m.len()).map_err(|e| e.to_string())
}

fn extract_pdf_text(path: &str) -> Result<String, String> {
    // pdf-extract can panic on some malformed PDFs — isolate it so we degrade gracefully.
    let p = path.to_string();
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| pdf_extract::extract_text(&p)));
    match res {
        Ok(Ok(t)) if !t.trim().is_empty() => Ok(normalize_pdf_text(&t)),
        Ok(Ok(_))  => Err("No selectable text found — this PDF may be scanned images.".to_string()),
        Ok(Err(e)) => Err(format!("Couldn't read this PDF: {}", e)),
        Err(_)     => Err("Couldn't read this PDF (it may be encrypted or corrupted).".to_string()),
    }
}

// pdf-extract emits a blank line between almost every visual line, which renders as a
// spaced-out, hard-to-read wall. Trim trailing space and collapse any run of blank
// lines to a single one so the text reads like the original document.
fn normalize_pdf_text(t: &str) -> String {
    let mut out = String::new();
    let mut blanks = 0;
    for line in t.lines() {
        let l = line.trim_end();
        if l.trim().is_empty() {
            blanks += 1;
            if blanks == 1 { out.push('\n'); }
        } else {
            blanks = 0;
            out.push_str(l);
            out.push('\n');
        }
    }
    out.trim().to_string()
}

// Render a workbook as clean GitHub-flavored-markdown tables. The naive "every row is a
// table row" approach breaks on real sheets: merged title rows (a single wide cell) and
// ragged row widths make the markdown table collapse. Instead: neutralize newlines/pipes
// inside cells, treat leading single-cell rows as captions, and build ONE aligned table
// per sheet (header + separator, every row padded to the sheet's width).
fn extract_spreadsheet_text(path: &str) -> Result<String, String> {
    use calamine::{open_workbook_auto, Reader};
    let mut wb = open_workbook_auto(path).map_err(|e| format!("Couldn't open spreadsheet: {}", e))?;
    let mut out = String::new();
    let names = wb.sheet_names().to_owned();
    let multi = names.len() > 1;
    for name in names {
        let range = match wb.worksheet_range(&name) { Ok(r) => r, Err(_) => continue };
        if range.is_empty() { continue; }
        // Clean every cell: strip newlines/tabs (they'd break the row) and escape pipes.
        // `_x000D_` is the literal OOXML escape for a carriage return that calamine leaves in
        // shared strings (e.g. multi-line addresses) — turn it into a space too, or the table
        // fills with "_x000D_" noise.
        let rows: Vec<Vec<String>> = range.rows().map(|r| {
            r.iter().map(|c| c.to_string()
                .replace("_x000D_", " ")
                .replace(['\r', '\n', '\t'], " ")
                .replace('|', "/")
                .split_whitespace().collect::<Vec<_>>().join(" ")
            ).collect()
        }).collect();
        let width = rows.iter().map(|r| r.len()).max().unwrap_or(0);
        if width == 0 { continue; }
        if multi { out.push_str(&format!("## {}\n\n", name)); }
        // The real table starts at the first row with 2+ filled cells — earlier single-cell
        // rows are titles/captions and are emitted as bold lines above the table.
        let first_table = rows.iter().position(|r| r.iter().filter(|c| !c.trim().is_empty()).count() >= 2);
        let mut header_done = false;
        for (i, r) in rows.iter().enumerate() {
            let filled = r.iter().filter(|c| !c.trim().is_empty()).count();
            if filled == 0 { continue; }
            if first_table.map_or(true, |ft| i < ft) {
                let cap = r.iter().find(|c| !c.trim().is_empty()).cloned().unwrap_or_default();
                out.push_str(&format!("**{}**\n\n", cap));
                continue;
            }
            let mut cells = r.clone();
            cells.resize(width, String::new());
            out.push_str("| ");
            out.push_str(&cells.join(" | "));
            out.push_str(" |\n");
            if !header_done {
                out.push_str("| ");
                out.push_str(&vec!["---"; width].join(" | "));
                out.push_str(" |\n");
                header_done = true;
            }
        }
        out.push('\n');
    }
    if out.trim().is_empty() {
        return Err("The spreadsheet appears to be empty.".to_string());
    }
    Ok(out)
}

// Pull the visible text out of an OOXML part (PPTX slides / DOCX document). Text runs
// live in <a:t> (PPTX) and <w:t> (DOCX); paragraphs end at <a:p>/<w:p>. Slides are
// numbered (slide1.xml, slide2.xml…) so we sort them into presentation order.
fn extract_ooxml_text(path: &str, prefix: &str) -> Result<String, String> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("Not a valid Office file: {}", e))?;
    let mut parts: Vec<String> = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().map(|f| f.name().to_string()))
        .filter(|n| n.starts_with(prefix) && n.ends_with(".xml"))
        .collect();
    parts.sort_by_key(|n| trailing_number(n));
    let mut out = String::new();
    for name in parts {
        let mut xml = String::new();
        if let Ok(mut f) = zip.by_name(&name) {
            if f.read_to_string(&mut xml).is_ok() {
                out.push_str(&ooxml_runs_to_text(&xml));
                out.push('\n');
            }
        }
    }
    if out.trim().is_empty() {
        return Err("No readable text found in this file.".to_string());
    }
    Ok(out)
}

fn trailing_number(name: &str) -> u32 {
    name.trim_end_matches(".xml")
        .chars().rev().take_while(|c| c.is_ascii_digit())
        .collect::<String>().chars().rev().collect::<String>()
        .parse().unwrap_or(0)
}

fn ooxml_runs_to_text(xml: &str) -> String {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;
    let mut reader = Reader::from_str(xml);
    let mut out = String::new();
    let mut in_text = false;
    let is_run  = |n: &[u8]| n.ends_with(b":t") || n == b"t";
    let is_para = |n: &[u8]| n.ends_with(b":p") || n == b"p";
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => { if is_run(e.name().as_ref()) { in_text = true; } }
            Ok(Event::End(e)) => {
                let n = e.name();
                if is_run(n.as_ref())  { in_text = false; }
                if is_para(n.as_ref()) { out.push('\n'); }
            }
            Ok(Event::Text(t)) => { if in_text { out.push_str(&t.unescape().unwrap_or_default()); } }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out
}

#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;
    let (tx, rx) = oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|p| p.to_string()));
    });
    Ok(rx.await.ok().flatten())
}

// ─── Folder scanner for compliance ───────────────────────────────────────────

#[tauri::command]
async fn scan_folder_for_compliance(folder_path: String) -> Result<String, String> {
    use std::path::Path;

    const SKIP_DIRS:  &[&str] = &["node_modules", ".git", "dist", "build", "target",
                                   "__pycache__", ".next", ".nuxt", "vendor", ".cache",
                                   "coverage", ".turbo", "out", ".svelte-kit", "venv", ".venv"];
    const INCLUDE_EXTS: &[&str] = &[".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs",
                                     ".java", ".rb", ".php", ".md", ".txt", ".json",
                                     ".yaml", ".yml", ".toml", ".html", ".css", ".env",
                                     ".sh", ".sql", ".prisma", ".graphql", ".xml", ".tf"];
    const SKIP_FILES: &[&str] = &["package-lock.json", "yarn.lock", "Cargo.lock",
                                   "pnpm-lock.yaml", "composer.lock", "poetry.lock", "go.sum"];
    const PRIORITY:   &[&str] = &["privacy", "terms", "security", "readme", "server",
                                   "app", "main", "index", "routes", "schema", "api",
                                   "auth", ".env", "config", "docker", "middleware"];

    fn walk(
        dir: &Path,
        root: &Path,
        out: &mut Vec<(String, String)>,
    ) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if path.is_dir() {
                if SKIP_DIRS.contains(&name) { continue; }
                walk(&path, root, out);
            } else if path.is_file() {
                if SKIP_FILES.contains(&name) { continue; }
                let lower_name = name.to_lowercase();
                if !INCLUDE_EXTS.iter().any(|ext| lower_name.ends_with(ext)) { continue; }
                let Ok(meta) = std::fs::metadata(&path) else { continue };
                if meta.len() > 80_000 { continue; } // skip files > 80 KB
                let Ok(content) = std::fs::read_to_string(&path) else { continue };
                let rel = path.strip_prefix(root).unwrap_or(&path)
                    .to_string_lossy().replace('\\', "/");
                out.push((rel, content));
            }
        }
    }

    let root = Path::new(&folder_path);
    let mut files: Vec<(String, String)> = Vec::new();
    walk(root, root, &mut files);

    if files.is_empty() {
        return Err("No relevant source files found in this folder.".to_string());
    }

    // Sort by priority: important files first
    files.sort_by_key(|(rel, _)| {
        let lower = rel.to_lowercase();
        PRIORITY.iter().position(|p| lower.contains(p)).unwrap_or(PRIORITY.len())
    });

    // Concatenate up to ~14 000 chars, with per-file headers
    let max_chars = 14_000usize;
    let mut body   = String::new();
    let mut used   = 0usize;
    let mut included = 0usize;

    for (rel, content) in &files {
        if used >= max_chars { break; }
        let header  = format!("\n// ─── {} ───\n", rel);
        let budget  = max_chars.saturating_sub(used + header.len());
        if budget == 0 { break; }
        let slice = if content.len() > budget { &content[..budget] } else { content.as_str() };
        body.push_str(&header);
        body.push_str(slice);
        used += header.len() + slice.len();
        included += 1;
    }

    let summary = format!(
        "Folder: {}\nTotal files found: {}  |  Files included in scan: {} (14 000 char limit)\n",
        folder_path, files.len(), included
    );
    Ok(summary + &body)
}

// ─── AI streaming ────────────────────────────────────────────────────────────

use serde::Deserialize;
use reqwest::header;

#[derive(Serialize, Deserialize, Clone)]
struct AiMessage { role: String, content: String }

#[tauri::command]
async fn ai_stream(
    app: tauri::AppHandle,
    call_id: String,
    mode: String,
    messages: Vec<AiMessage>,
    api_key: Option<String>,
    provider: Option<String>,
    _local_model: Option<String>,
    model_name: Option<String>,
    base_url: Option<String>,
    session_token: Option<String>,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let cid = call_id.clone();
    let emit_chunk = {
        let app = app.clone();
        move |text: String| { let _ = app.emit("ai-chunk", serde_json::json!({ "id": cid, "text": text })); }
    };
    let cid = call_id.clone();
    let emit_done = {
        let app = app.clone();
        move || { let _ = app.emit("ai-done", serde_json::json!({ "id": cid })); }
    };
    let cid = call_id.clone();
    let emit_error = {
        let app = app.clone();
        move |err: String| { let _ = app.emit("ai-error", serde_json::json!({ "id": cid, "error": err })); }
    };

    match mode.as_str() {
        "local" => {
            // adris-engine (llama.cpp) serves OpenAI-compatible API on port 8080
            let msgs: Vec<serde_json::Value> = messages.iter()
                .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
                .collect();
            let body = serde_json::json!({ "model": "local", "messages": msgs, "stream": true });
            let resp = reqwest::Client::new()
                .post("http://127.0.0.1:8080/v1/chat/completions")
                .json(&body).send().await
                .map_err(|e| { let s = format!("Local AI engine not running. Load a model first in the Models tab. ({})", e); emit_error(s.clone()); s })?;
            let mut stream = resp.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let bytes = chunk.map_err(|e| e.to_string())?;
                for line in String::from_utf8_lossy(&bytes).lines() {
                    if let Some(data) = line.strip_prefix("data: ") {
                        if data.trim() == "[DONE]" { emit_done(); return Ok(()); }
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(t) = v["choices"][0]["delta"]["content"].as_str() {
                                if !t.is_empty() { emit_chunk(t.to_string()); }
                            }
                        }
                    }
                }
            }
            emit_done();
        }

        "own_key" => {
            let key  = api_key.unwrap_or_default();
            let prov = provider.unwrap_or_else(|| "openai".to_string());

            if prov == "claude" {
                // ── Anthropic Claude ────────────────────────────────────────
                let model = model_name.unwrap_or_else(|| "claude-3-5-haiku-20241022".to_string());
                let client = reqwest::Client::new();
                let body = serde_json::json!({
                    "model": model, "max_tokens": 4096, "stream": true, "messages": messages,
                });
                let resp = client.post("https://api.anthropic.com/v1/messages")
                    .header("x-api-key", &key)
                    .header("anthropic-version", "2023-06-01")
                    .header(header::CONTENT_TYPE, "application/json")
                    .json(&body).send().await
                    .map_err(|e| { let s = e.to_string(); emit_error(s.clone()); s })?;
                let mut stream = resp.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    let bytes = chunk.map_err(|e| e.to_string())?;
                    let text = String::from_utf8_lossy(&bytes);
                    for line in text.lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            if data == "[DONE]" { emit_done(); return Ok(()); }
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                                if v["type"] == "content_block_delta" {
                                    if let Some(t) = v["delta"]["text"].as_str() { emit_chunk(t.to_string()); }
                                }
                            }
                        }
                    }
                }
                emit_done();

            } else if prov == "gemini" {
                // ── Google Gemini ────────────────────────────────────────────
                let model = model_name.unwrap_or_else(|| "gemini-2.5-flash-lite".to_string());
                let url = format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?key={}&alt=sse",
                    model, key
                );
                let gemini_msgs: Vec<serde_json::Value> = messages.iter().map(|m| serde_json::json!({
                    "role": if m.role == "assistant" { "model" } else { "user" },
                    "parts": [{ "text": m.content }]
                })).collect();
                let body = serde_json::json!({ "contents": gemini_msgs });
                let resp = reqwest::Client::new().post(&url).json(&body).send().await
                    .map_err(|e| { let s = e.to_string(); emit_error(s.clone()); s })?;
                if !resp.status().is_success() {
                    let status = resp.status();
                    let body_text = resp.text().await.unwrap_or_default();
                    let msg = if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body_text) {
                        v["error"]["message"].as_str().unwrap_or(&body_text).chars().take(300).collect::<String>()
                    } else { body_text.chars().take(300).collect::<String>() };
                    emit_error(format!("Gemini error ({}): {}", status.as_u16(), msg));
                    return Ok(());
                }
                let mut stream = resp.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    let bytes = chunk.map_err(|e| e.to_string())?;
                    let text = String::from_utf8_lossy(&bytes);
                    for line in text.lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                                // Skip thinking-mode parts (gemini-2.5-flash and above)
                                if let Some(parts) = v["candidates"][0]["content"]["parts"].as_array() {
                                    for part in parts {
                                        if part["thought"].as_bool() == Some(true) { continue; }
                                        if let Some(t) = part["text"].as_str() { emit_chunk(t.to_string()); }
                                    }
                                }
                            }
                        }
                    }
                }
                emit_done();

            } else {
                // ── OpenAI-compatible (OpenAI, Groq, Mistral, Perplexity, Together, DeepSeek, Custom) ──
                let endpoint = base_url.unwrap_or_else(|| match prov.as_str() {
                    "openai"     => "https://api.openai.com/v1/chat/completions",
                    "groq"       => "https://api.groq.com/openai/v1/chat/completions",
                    "mistral"    => "https://api.mistral.ai/v1/chat/completions",
                    "perplexity" => "https://api.perplexity.ai/chat/completions",
                    "together"   => "https://api.together.xyz/v1/chat/completions",
                    "deepseek"   => "https://api.deepseek.com/v1/chat/completions",
                    _            => "https://api.openai.com/v1/chat/completions",
                }.to_string());

                let model = model_name.unwrap_or_else(|| "gpt-4o".to_string());
                let body = serde_json::json!({
                    "model": model, "messages": messages, "stream": true,
                });
                let resp = reqwest::Client::new()
                    .post(&endpoint)
                    .header(header::AUTHORIZATION, format!("Bearer {}", key))
                    .header(header::CONTENT_TYPE, "application/json")
                    .json(&body).send().await
                    .map_err(|e| { let s = e.to_string(); emit_error(s.clone()); s })?;

                // Check for non-2xx before streaming
                let status = resp.status();
                if !status.is_success() {
                    let body = resp.text().await.unwrap_or_default();
                    let err = format!("{} — {}", status, body.chars().take(200).collect::<String>());
                    emit_error(err);
                    return Ok(());
                }

                let mut stream = resp.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    let bytes = chunk.map_err(|e| e.to_string())?;
                    let text = String::from_utf8_lossy(&bytes);
                    for line in text.lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            if data.trim() == "[DONE]" { emit_done(); return Ok(()); }
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                                if let Some(t) = v["choices"][0]["delta"]["content"].as_str() {
                                    if !t.is_empty() { emit_chunk(t.to_string()); }
                                }
                            }
                        }
                    }
                }
                emit_done();
            }
        }

        "nivara" => {
            let token = session_token.unwrap_or_default();
            if token.is_empty() {
                emit_error("Sign in to adris.tech to use adris.tech AI.".to_string());
                return Ok(());
            }
            // Fast path: use session key for direct Gemini call (no Edge Function overhead)
            let sk_arc = {
                let st = app.state::<SessionKeyState>();
                let g = st.0.lock().unwrap();
                g.as_ref().and_then(|a| {
                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default().as_millis() as i64;
                    if a.expires_at > now_ms && a.remaining.load(std::sync::atomic::Ordering::Relaxed) > 0 {
                        Some(a.clone())
                    } else { None }
                })
            };
            if let Some(sk) = sk_arc {
                let gkey = sk.key.get();
                let url = format!("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?key={}&alt=sse", gkey);
                let contents: Vec<serde_json::Value> = messages.iter().map(|m| serde_json::json!({
                    "role": if m.role == "assistant" { "model" } else { "user" },
                    "parts": [{ "text": m.content }]
                })).collect();
                let body = serde_json::json!({ "contents": contents, "generationConfig": { "maxOutputTokens": 32768 } });
                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(120))
                    .build().unwrap_or_else(|_| reqwest::Client::new());
                let resp = client.post(&url).json(&body).send().await
                    .map_err(|e| { let s = e.to_string(); emit_error(s.clone()); s })?;
                if !resp.status().is_success() {
                    let st = resp.status(); let eb = resp.text().await.unwrap_or_default();
                    emit_error(format!("{} — {}", st, eb.chars().take(300).collect::<String>()));
                    return Ok(());
                }
                let mut chars = 0i64;
                let mut stream = resp.bytes_stream();
                // Buffer bytes across TCP chunks and only parse COMPLETE lines (ending in \n).
                // Without this, a single SSE `data: {…}` event split across two network reads
                // was parsed as two broken halves and DROPPED — silently corrupting long
                // outputs (e.g. a full slide deck came back as mangled/invalid JSON).
                let mut buf: Vec<u8> = Vec::new();
                'outer_ai: while let Some(chunk) = stream.next().await {
                    let bytes = chunk.map_err(|e| { let s = format!("Stream interrupted: {}", e); emit_error(s.clone()); s })?;
                    buf.extend_from_slice(&bytes);
                    while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
                        let mut line_bytes: Vec<u8> = buf.drain(..=pos).collect();
                        line_bytes.pop(); // drop '\n'
                        if line_bytes.last() == Some(&b'\r') { line_bytes.pop(); }
                        let line = String::from_utf8_lossy(&line_bytes);
                        if let Some(data) = line.strip_prefix("data: ") {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                                if let Some(parts) = v["candidates"][0]["content"]["parts"].as_array() {
                                    for part in parts {
                                        if part["thought"].as_bool() == Some(true) { continue; }
                                        if let Some(t) = part["text"].as_str() {
                                            if !t.is_empty() { chars += t.len() as i64; emit_chunk(t.to_string()); }
                                        }
                                    }
                                }
                                let fin = v["candidates"][0]["finishReason"].as_str().unwrap_or("");
                                if fin == "STOP" || fin == "MAX_TOKENS" {
                                    let toks = (chars / 4).max(1);
                                    sk.remaining.fetch_sub(toks, std::sync::atomic::Ordering::Relaxed);
                                    let _ = app.emit("nivara-tokens", serde_json::json!({ "tokens": toks }));
                                    emit_done(); return Ok(());
                                }
                                if v["candidates"][0]["finishReason"].is_string() { break 'outer_ai; }
                            }
                        }
                    }
                }
                let toks = (chars / 4).max(1);
                sk.remaining.fetch_sub(toks, std::sync::atomic::Ordering::Relaxed);
                let _ = app.emit("nivara-tokens", serde_json::json!({ "tokens": toks }));
                emit_done();
            } else {
                // Fallback: route via krew-stream Edge Function
                let fn_url = "https://xkkqcqsacgdrfwbwdqsp.supabase.co/functions/v1/krew-stream";
                let mut all_msgs: Vec<serde_json::Value> = Vec::new();
                for m in &messages { all_msgs.push(serde_json::json!({"role": m.role, "content": m.content})); }
                let body = serde_json::json!({ "messages": all_msgs, "systemPrompt": "" });
                let client = reqwest::Client::builder()
                    .http1_only()
                    .timeout(std::time::Duration::from_secs(120))
                    .build().unwrap_or_else(|_| reqwest::Client::new());
                let resp = client
                    .post(fn_url)
                    .header("Authorization", format!("Bearer {}", token))
                    .header(header::CONTENT_TYPE, "application/json")
                    .json(&body).send().await
                    .map_err(|e| { let s = e.to_string(); emit_error(s.clone()); s })?;
                if !resp.status().is_success() {
                    let status = resp.status();
                    let body_text = resp.text().await.unwrap_or_default();
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body_text) {
                        if let Some(e) = v["error"].as_str() { emit_error(e.to_string()); return Ok(()); }
                    }
                    emit_error(format!("{} — {}", status, body_text.chars().take(300).collect::<String>()));
                    return Ok(());
                }
                let mut stream = resp.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    let bytes = chunk.map_err(|e| { let s = format!("Stream interrupted: {}", e); emit_error(s.clone()); s })?;
                    for line in String::from_utf8_lossy(&bytes).lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            if data == "[DONE]" { emit_done(); return Ok(()); }
                            if data == "[TRUNCATED]" { continue; }
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                                if let Some(t) = v["text"].as_str() {
                                    if !t.is_empty() { emit_chunk(t.to_string()); }
                                }
                            }
                        }
                    }
                }
                emit_done();
            }
        }

        _ => emit_error(format!("Unknown mode: {}", mode)),
    }

    Ok(())
}

// ─── SQLite chat history ─────────────────────────────────────────────────────

use rusqlite::{Connection, params};

struct DbConn(Mutex<Connection>);

fn init_db(app: &tauri::App) -> rusqlite::Result<Connection> {
    let dir = app.path().app_data_dir().unwrap();
    std::fs::create_dir_all(&dir).ok();
    let conn = Connection::open(dir.join("coder-chat.db"))?;
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS sessions (
            id          TEXT PRIMARY KEY,
            project     TEXT NOT NULL,
            mode        TEXT NOT NULL,
            model       TEXT,
            title       TEXT,
            created_at  INTEGER NOT NULL,
            last_active INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            role        TEXT NOT NULL,
            content     TEXT NOT NULL,
            tokens      INTEGER DEFAULT 0,
            created_at  INTEGER NOT NULL
        );
        PRAGMA foreign_keys = ON;
    ")?;
    Ok(conn)
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

#[derive(Serialize)]
struct SessionRow {
    id: String, project_path: String, mode: String, model: Option<String>,
    title: Option<String>, created_at: i64, last_active: i64, message_count: i64,
}

#[derive(Serialize)]
struct MessageRow {
    id: i64, session_id: String, role: String,
    content: String, tokens: i64, created_at: i64,
}

#[tauri::command]
fn db_new_session(
    db: tauri::State<DbConn>,
    project_path: String,
    mode: String,
    model: Option<String>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let t  = now_secs();
    db.0.lock().unwrap().execute(
        "INSERT INTO sessions (id,project,mode,model,created_at,last_active) VALUES (?1,?2,?3,?4,?5,?5)",
        params![id, project_path, mode, model, t],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
fn db_save_message(
    db: tauri::State<DbConn>,
    session_id: String,
    role: String,
    content: String,
    tokens: i64,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let t = now_secs();
    conn.execute(
        "INSERT INTO messages (session_id,role,content,tokens,created_at) VALUES (?1,?2,?3,?4,?5)",
        params![session_id, role, content, tokens, t],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE sessions SET last_active=?1 WHERE id=?2",
        params![t, session_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_get_sessions(db: tauri::State<DbConn>, project_path: String) -> Result<Vec<SessionRow>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT s.id,s.project,s.mode,s.model,s.title,s.created_at,s.last_active,
                COUNT(m.id) as cnt
         FROM sessions s LEFT JOIN messages m ON m.session_id=s.id
         WHERE s.project=?1 GROUP BY s.id ORDER BY s.last_active DESC LIMIT 100"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![project_path], |row| Ok(SessionRow {
        id: row.get(0)?, project_path: row.get(1)?, mode: row.get(2)?,
        model: row.get(3)?, title: row.get(4)?,
        created_at: row.get(5)?, last_active: row.get(6)?, message_count: row.get(7)?,
    })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_messages(db: tauri::State<DbConn>, session_id: String) -> Result<Vec<MessageRow>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id,session_id,role,content,tokens,created_at FROM messages WHERE session_id=?1 ORDER BY id"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![session_id], |row| Ok(MessageRow {
        id: row.get(0)?, session_id: row.get(1)?, role: row.get(2)?,
        content: row.get(3)?, tokens: row.get(4)?, created_at: row.get(5)?,
    })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_session(db: tauri::State<DbConn>, session_id: String) -> Result<(), String> {
    db.0.lock().unwrap()
        .execute("DELETE FROM sessions WHERE id=?1", params![session_id])
        .map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_all(db: tauri::State<DbConn>, project_path: String) -> Result<(), String> {
    db.0.lock().unwrap()
        .execute("DELETE FROM sessions WHERE project=?1", params![project_path])
        .map(|_| ()).map_err(|e| e.to_string())
}

// ─── System info ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct SystemInfo {
    total_ram_gb:     f32,
    available_ram_gb: f32,
    cpu_count:        usize,
    os_name:          String,
}

#[tauri::command]
fn get_system_info() -> SystemInfo {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_list(sysinfo::CpuRefreshKind::new());
    SystemInfo {
        total_ram_gb:     sys.total_memory()     as f32 / 1_073_741_824.0,
        available_ram_gb: sys.available_memory() as f32 / 1_073_741_824.0,
        cpu_count:        sys.cpus().len(),
        os_name:          System::name().unwrap_or_else(|| "Unknown".to_string()),
    }
}

// ─── GPU Detection ───────────────────────────────────────────────────────────

#[derive(Serialize)]
struct GpuInfo {
    name:    String,
    vram_gb: f32,
}

#[tauri::command]
fn detect_gpu() -> Vec<GpuInfo> {
    use std::process::Command;
    let out = Command::new("wmic")
        .args(["path", "win32_VideoController", "get", "Name,AdapterRAM", "/format:csv"])
        .output();
    let Ok(out) = out else { return vec![]; };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut gpus = vec![];
    for line in text.lines().skip(2) {
        let parts: Vec<&str> = line.splitn(3, ',').collect();
        if parts.len() < 3 { continue; }
        let vram_bytes: u64 = parts[1].trim().parse().unwrap_or(0);
        let name = parts[2].trim().to_string();
        if !name.is_empty() && !name.to_lowercase().contains("microsoft") {
            gpus.push(GpuInfo {
                name,
                vram_gb: if vram_bytes > 1_073_741_824 {
                    (vram_bytes as f32 / 1_073_741_824.0 * 10.0).round() / 10.0
                } else {
                    0.0
                },
            });
        }
    }
    gpus
}

// ─── Models — local install registry ─────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Default)]
struct InstalledModel {
    id:           String,
    name:         String,
    filename:     String,
    size_gb:      f32,
    installed_at: String,
    last_used:    Option<String>,
    path:         String,
}

fn models_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("nivara-models");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn load_installed_models(dir: &std::path::Path) -> Vec<InstalledModel> {
    let p = dir.join("registry.json");
    if !p.exists() { return vec![]; }
    let c = std::fs::read_to_string(p).unwrap_or_default();
    serde_json::from_str(&c).unwrap_or_default()
}

fn save_installed_models(dir: &std::path::Path, list: &[InstalledModel]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("registry.json"), json).map_err(|e| e.to_string())
}

#[tauri::command]
fn models_list_installed(app: tauri::AppHandle) -> Result<Vec<InstalledModel>, String> {
    let dir = models_dir(&app)?;
    Ok(load_installed_models(&dir))
}

#[tauri::command]
async fn models_download(
    app:        tauri::AppHandle,
    model_id:   String,
    model_name: String,
    url:        String,
    filename:   String,
    size_gb:    f32,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let dir = models_dir(&app)?;
    let dest = dir.join(&filename);

    let client = reqwest::Client::new();
    let resp = client.get(&url)
        .header("User-Agent", "NivaraDesktop/1.0")
        .send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file = tokio::fs::File::create(&dest).await.map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let pct = (downloaded as f64 / total as f64 * 100.0) as u32;
            let _ = app.emit("model_download_progress", serde_json::json!({
                "model_id":     model_id,
                "pct":          pct,
                "downloaded_gb": downloaded as f64 / 1_073_741_824.0,
                "total_gb":     total as f64 / 1_073_741_824.0,
            }));
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;

    // Register in local registry
    let mut list = load_installed_models(&dir);
    list.retain(|m| m.id != model_id);
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        list.push(InstalledModel {
            id:           model_id.clone(),
            name:         model_name,
            filename,
            size_gb,
            installed_at: format!("{}", secs),
            last_used:    None,
            path:         dest.to_str().unwrap_or_default().to_string(),
        });
    }
    save_installed_models(&dir, &list)?;
    let _ = app.emit("model_download_complete", serde_json::json!({ "model_id": model_id }));
    Ok(())
}

#[tauri::command]
fn models_delete(app: tauri::AppHandle, model_id: String) -> Result<(), String> {
    let dir = models_dir(&app)?;
    let mut list = load_installed_models(&dir);
    if let Some(m) = list.iter().find(|m| m.id == model_id).cloned() {
        let _ = std::fs::remove_file(&m.path);
    }
    list.retain(|m| m.id != model_id);
    save_installed_models(&dir, &list)
}

// ─── llama.cpp engine state ──────────────────────────────────────────────────

struct LlamaEngineProcess(Mutex<Option<tokio::process::Child>>);

fn llama_engine_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let exe_name = if cfg!(target_os = "windows") { "adris-engine.exe" } else { "adris-engine" };
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join(exe_name);
        if p.exists() { return Some(p); }
    }
    if let Ok(data) = app.path().app_data_dir() {
        let p = data.join("adris-ai").join(exe_name);
        if p.exists() { return Some(p); }
    }
    None
}

#[tauri::command]
fn models_check_engine_installed(app: tauri::AppHandle) -> bool {
    llama_engine_path(&app).is_some()
}

#[tauri::command]
async fn models_check_engine() -> bool {
    reqwest::get("http://127.0.0.1:8080/health").await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

#[tauri::command]
async fn models_stop_engine(state: tauri::State<'_, LlamaEngineProcess>) -> Result<(), String> {
    let old_child = { let mut g = state.0.lock().unwrap(); g.take() };
    if let Some(mut child) = old_child { let _ = child.kill().await; }
    Ok(())
}

#[tauri::command]
async fn models_run(
    app:            tauri::AppHandle,
    model_filename: String,
    state:          tauri::State<'_, LlamaEngineProcess>,
) -> Result<(), String> {
    let dir    = models_dir(&app)?;
    let models = load_installed_models(&dir);
    let model  = models.iter()
        .find(|m| m.filename == model_filename || m.id == model_filename)
        .ok_or_else(|| format!("Model '{}' not found", model_filename))?;
    let model_path = model.path.clone();

    let engine = llama_engine_path(&app)
        .ok_or("Local AI engine not found. Open Settings → Setup to download it.")?;

    // Stop any currently running server — take child OUT of mutex before awaiting
    let old_child = { let mut g = state.0.lock().unwrap(); g.take() };
    if let Some(mut child) = old_child { let _ = child.kill().await; }
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;

    let child = tokio::process::Command::new(&engine)
        .args(["-m", &model_path, "--port", "8080", "--host", "127.0.0.1",
               "-c", "4096", "--log-disable"])
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Could not start engine: {e}"))?;

    { let mut g = state.0.lock().unwrap(); *g = Some(child); }

    // Wait for the server to become ready (up to 30 s)
    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if reqwest::get("http://127.0.0.1:8080/health").await
            .map(|r| r.status().is_success()).unwrap_or(false)
        { return Ok(()); }
    }
    Err("Engine started but is not responding. Try again or restart the app.".into())
}

#[tauri::command]
async fn models_download_engine(app: tauri::AppHandle) -> Result<(), String> {
    use std::io::Read as _;

    let dest_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?.join("adris-ai");
    tokio::fs::create_dir_all(&dest_dir).await.map_err(|e| e.to_string())?;
    let exe_name = if cfg!(target_os = "windows") { "adris-engine.exe" } else { "adris-engine" };
    let dest_exe = dest_dir.join(exe_name);
    if dest_exe.exists() { return Ok(()); }

    let _ = app.emit("engine_download_progress",
        serde_json::json!({ "step": "Setting up local AI engine…", "pct": 10 }));

    // Extract the zip bundled inside the installer (no network required)
    let zip_path = app.path().resource_dir()
        .map_err(|e| e.to_string())?
        .join("adris-engine.zip");
    if !zip_path.exists() {
        return Err("Bundled engine not found. Please reinstall the app.".into());
    }

    let _ = app.emit("engine_download_progress",
        serde_json::json!({ "step": "Extracting AI engine files…", "pct": 30 }));

    let zip_bytes = std::fs::read(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes))
        .map_err(|e| e.to_string())?;
    let total = archive.len().max(1);
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name.ends_with('/') { continue; }
        let out_path = dest_dir.join(&name);
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(&out_path, &buf).map_err(|e| e.to_string())?;
        let pct = 30 + (i as f64 / total as f64 * 65.0) as u32;
        let _ = app.emit("engine_download_progress",
            serde_json::json!({ "step": format!("Extracting… {}/{}", i + 1, total), "pct": pct }));
    }

    let _ = app.emit("engine_download_progress",
        serde_json::json!({ "step": "Engine ready ✓", "pct": 100 }));
    Ok(())
}

#[tauri::command]
async fn models_pick_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;
    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("GGUF model", &["gguf"])
        .pick_file(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });
    Ok(rx.await.ok().flatten())
}

// Generic file picker for the Brain — returns any chosen file's full path.
#[tauri::command]
async fn brain_pick_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;
    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .pick_file(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });
    Ok(rx.await.ok().flatten())
}

#[tauri::command]
async fn studio_save_file(
    app: tauri::AppHandle,
    default_name: String,
    content: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;
    let (tx, rx) = oneshot::channel::<Option<tauri_plugin_dialog::FilePath>>();
    app.dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("HTML file", &["html"])
        .save_file(move |path| { let _ = tx.send(path); });
    let path = rx.await.ok().flatten();
    if let Some(p) = path {
        let full = p.to_string();
        std::fs::write(&full, content.as_bytes()).map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
async fn models_import(
    app:            tauri::AppHandle,
    source_path:    String,
    model_name:     String,
    context_length: i64,
    format:         String,
) -> Result<InstalledModel, String> {
    use std::path::Path;
    use tokio::fs;
    let _ = context_length;
    let _ = format;

    let dir = models_dir(&app)?;
    let src = Path::new(&source_path);
    let filename = src.file_name()
        .and_then(|f| f.to_str())
        .ok_or("Invalid file path")?
        .to_string();
    let dest = dir.join(&filename);

    fs::copy(&src, &dest).await.map_err(|e| format!("Copy failed: {e}"))?;

    let size_gb = {
        let meta = fs::metadata(&dest).await.map_err(|e| e.to_string())?;
        (meta.len() as f32) / 1_073_741_824.0
    };

    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    let id = filename
        .to_lowercase()
        .replace(' ', "-")
        .replace(".gguf", "")
        .replace(".safetensors", "");

    let mut list = load_installed_models(&dir);
    list.retain(|m| m.id != id);
    let model = InstalledModel {
        id:           id.clone(),
        name:         model_name,
        filename:     filename.clone(),
        size_gb:      (size_gb * 10.0).round() / 10.0,
        installed_at: format!("{}", secs),
        last_used:    None,
        path:         dest.to_str().unwrap_or_default().to_string(),
    };
    list.push(model.clone());
    save_installed_models(&dir, &list)?;
    Ok(model)
}

// ─── Recent sessions (cross-project, for home screen) ────────────────────────

#[tauri::command]
fn db_get_recent_sessions(
    db: tauri::State<DbConn>,
    limit: i64,
) -> Result<Vec<SessionRow>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT s.id, s.project, s.mode, s.model, s.title, s.created_at, s.last_active,
                COUNT(m.id) as cnt
         FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
         GROUP BY s.id ORDER BY s.last_active DESC LIMIT ?1"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![limit], |row| Ok(SessionRow {
        id: row.get(0)?, project_path: row.get(1)?, mode: row.get(2)?,
        model: row.get(3)?, title: row.get(4)?,
        created_at: row.get(5)?, last_active: row.get(6)?, message_count: row.get(7)?,
    })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ─── Token tracking ──────────────────────────────────────────────────────────

#[tauri::command]
async fn track_token_usage(
    supabase_url: String,
    supabase_anon_key: String,
    session_token: String,
    user_id: String,
    module: String,
    tokens_used: i64,
) -> Result<(), String> {
    if session_token.is_empty() || user_id.is_empty() { return Ok(()); }
    let client = reqwest::Client::new();
    let _ = client
        .post(format!("{}/rest/v1/token_usage", supabase_url))
        .header("apikey", &supabase_anon_key)
        .header("Authorization", format!("Bearer {}", session_token))
        .header("Content-Type", "application/json")
        .header("Prefer", "return=minimal")
        .json(&serde_json::json!({
            "user_id":         user_id,
            "task_type":       module,
            "tokens_consumed": tokens_used,
            "model_used":      "gemini-3-flash-preview",
            "model_tier":      "flash-3-direct",
            "credits_consumed": 0,
        }))
        .send()
        .await;
    Ok(())
}

#[tauri::command]
async fn get_token_usage_this_month(
    supabase_url: String,
    supabase_anon_key: String,
    session_token: String,
    user_id: String,
) -> Result<i64, String> {
    if session_token.is_empty() || user_id.is_empty() { return Ok(0); }
    let now = chrono_month_start();
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/rest/v1/token_usage?select=tokens_consumed&user_id=eq.{}&created_at=gte.{}", supabase_url, user_id, now))
        .header("apikey", &supabase_anon_key)
        .header("Authorization", format!("Bearer {}", session_token))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let rows: Vec<serde_json::Value> = resp.json().await.unwrap_or_default();
    let sum: i64 = rows.iter()
        .filter_map(|r| r["tokens_consumed"].as_i64())
        .sum();
    Ok(sum)
}

// ─── Session key (adris.tech AI direct-call path) ─────────────────────────────

const CLIENT_PEPPER: &str = "nv-adris-2026-k7X9mP3q";

struct ObfuscatedKey { data: Vec<u8>, salt: Vec<u8> }
impl ObfuscatedKey {
    fn new(plain: &str) -> Self {
        let bytes = plain.as_bytes();
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().subsec_nanos();
        let pid = std::process::id();
        let len = bytes.len().max(32);
        let mut salt = vec![0u8; len];
        for (i, b) in salt.iter_mut().enumerate() {
            *b = (t.wrapping_add(pid).wrapping_add(i as u32 * 7).wrapping_mul(0x6B) ^ 0xA5) as u8;
        }
        let data: Vec<u8> = bytes.iter().enumerate().map(|(i, b)| b ^ salt[i % len]).collect();
        Self { data, salt }
    }
    fn get(&self) -> String {
        let plain: Vec<u8> = self.data.iter().enumerate()
            .map(|(i, b)| b ^ self.salt[i % self.salt.len()]).collect();
        String::from_utf8(plain).unwrap_or_default()
    }
}

struct SessionKeyInner {
    key:           ObfuscatedKey,
    plan:          String,
    remaining:     std::sync::atomic::AtomicI64,
    pending_usage: std::sync::atomic::AtomicI64,
    expires_at:    i64,
    user_id:       String,
}

struct SessionKeyState(Mutex<Option<Arc<SessionKeyInner>>>);
impl SessionKeyState { fn new() -> Self { Self(Mutex::new(None)) } }

fn sk_xor_mask(user_id: &str, nonce: &str) -> [u8; 32] {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type H = Hmac<Sha256>;
    let mut mac = H::new_from_slice(CLIENT_PEPPER.as_bytes()).expect("HMAC any key");
    mac.update(format!("{}:{}", user_id, nonce).as_bytes());
    mac.finalize().into_bytes().into()
}

fn sk_decrypt(enc_hex: &str, nonce: &str, user_id: &str) -> Option<String> {
    let mask = sk_xor_mask(user_id, nonce);
    let enc: Vec<u8> = (0..enc_hex.len()).step_by(2)
        .filter_map(|i| u8::from_str_radix(&enc_hex[i..i+2], 16).ok())
        .collect();
    String::from_utf8(enc.iter().enumerate().map(|(i, b)| b ^ mask[i % 32]).collect()).ok()
}

fn sk_decode_sub(token: &str) -> Option<String> {
    use base64::{Engine as _, engine::general_purpose};
    let parts: Vec<&str> = token.splitn(3, '.').collect();
    if parts.len() < 2 { return None; }
    let p = parts[1];
    let padded = format!("{}{}", p, "=".repeat((4 - p.len() % 4) % 4));
    let decoded = general_purpose::URL_SAFE.decode(&padded)
        .or_else(|_| general_purpose::URL_SAFE_NO_PAD.decode(p)).ok()?;
    serde_json::from_slice::<serde_json::Value>(&decoded).ok()
        .and_then(|v| v["sub"].as_str().map(|s| s.to_string()))
}

#[tauri::command]
async fn fetch_session_key(
    state: tauri::State<'_, SessionKeyState>,
    session_token: String,
) -> Result<serde_json::Value, String> {
    if session_token.is_empty() { return Err("No session token".to_string()); }
    let user_id = sk_decode_sub(&session_token).ok_or_else(|| "Invalid JWT".to_string())?;
    let client = reqwest::Client::builder()
        .http1_only()
        .timeout(std::time::Duration::from_secs(15))
        .build().unwrap_or_else(|_| reqwest::Client::new());
    let resp = client
        .post("https://xkkqcqsacgdrfwbwdqsp.supabase.co/functions/v1/get-session-key")
        .header("Authorization", format!("Bearer {}", session_token))
        .header("Content-Type", "application/json")
        .body("{}").send().await
        .map_err(|e| format!("Network error: {}", e))?;
    let status = resp.status();
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(json["error"].as_str().unwrap_or("Key fetch failed").to_string());
    }
    let enc        = json["enc"].as_str().ok_or("missing enc")?;
    let nonce      = json["nonce"].as_str().ok_or("missing nonce")?;
    let plan       = json["plan"].as_str().unwrap_or("free").to_string();
    let remaining  = json["remaining"].as_i64().unwrap_or(100_000);
    let expires_at = json["expires_at"].as_i64().unwrap_or(0);
    let plain = sk_decrypt(enc, nonce, &user_id).ok_or_else(|| "Decryption failed".to_string())?;
    if !plain.starts_with("AIza") { return Err("Key validation failed".to_string()); }
    *state.0.lock().unwrap() = Some(Arc::new(SessionKeyInner {
        key:           ObfuscatedKey::new(&plain),
        plan:          plan.clone(),
        remaining:     std::sync::atomic::AtomicI64::new(remaining),
        pending_usage: std::sync::atomic::AtomicI64::new(0),
        expires_at,
        user_id,
    }));
    Ok(serde_json::json!({ "ok": true, "plan": plan, "remaining": remaining }))
}

// Generate one image with a Gemini image model ("Nano Banana" = gemini-2.5-flash-image,
// "Nano Banana Pro" = gemini-3-pro-image-preview). Uses the caller's own Gemini key when
// `api_key` is provided (BYO — their cost); otherwise the managed adris.tech session key.
// Returns a data: URI. Used by the Advanced deck maker to put real images on slides.
#[tauri::command]
async fn krew_generate_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, SessionKeyState>,
    prompt: String,
    model: Option<String>,
    api_key: Option<String>,
) -> Result<String, String> {
    let model = model.unwrap_or_else(|| "gemini-2.5-flash-image".to_string());
    // Resolve key: explicit BYO key wins; else the managed session key.
    let (key, managed_sk) = match api_key.filter(|k| !k.trim().is_empty()) {
        Some(k) => (k, None),
        None => {
            let sk = {
                let g = state.0.lock().unwrap();
                g.as_ref().and_then(|a| {
                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as i64;
                    if a.expires_at > now_ms && a.remaining.load(std::sync::atomic::Ordering::Relaxed) > 0 {
                        Some(a.clone())
                    } else { None }
                })
            };
            match sk {
                Some(a) => (a.key.get(), Some(a)),
                None => return Err("No image key available — sign in to adris.tech or add your own Gemini key.".to_string()),
            }
        }
    };
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, key
    );
    let body = serde_json::json!({
        "contents": [{ "parts": [{ "text": prompt }] }],
        // IMAGE + TEXT is the widely-accepted combo for the image models; some reject IMAGE-only.
        "generationConfig": { "responseModalities": ["IMAGE", "TEXT"] }
    });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build().unwrap_or_else(|_| reqwest::Client::new());
    let resp = client.post(&url).json(&body).send().await
        .map_err(|e| format!("Image request failed: {}", e))?;
    if !resp.status().is_success() {
        let st = resp.status();
        let eb = resp.text().await.unwrap_or_default();
        return Err(format!("{} — {}", st, eb.chars().take(300).collect::<String>()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    // Find the first inline image part.
    let parts = v["candidates"][0]["content"]["parts"].as_array()
        .ok_or_else(|| "No image returned".to_string())?;
    for part in parts {
        // API may use inlineData (camel) or inline_data (snake) depending on version.
        let inline = if part["inlineData"].is_object() { &part["inlineData"] } else { &part["inline_data"] };
        if let Some(data) = inline["data"].as_str() {
            let mime = inline["mimeType"].as_str()
                .or_else(|| inline["mime_type"].as_str())
                .unwrap_or("image/png");
            // Bill the managed key and report it through the SAME meter as text
            // (nivara-tokens → token_usage). Nano Banana ≈ 1290 tok/image; Pro costs more.
            if let Some(sk) = &managed_sk {
                let cost: i64 = if model.contains("pro") { 3000 } else { 1290 };
                sk.remaining.fetch_sub(cost, std::sync::atomic::Ordering::Relaxed);
                let _ = app.emit("nivara-tokens", serde_json::json!({ "tokens": cost }));
            }
            return Ok(format!("data:{};base64,{}", mime, data));
        }
    }
    Err("Model returned no image (it may have refused the prompt).".to_string())
}

// Keyless, commercial-use image search used as a FALLBACK so a deck always has visuals even
// when AI image generation isn't available (no managed key / plan without image access / rate
// limit). Uses Openverse (aggregates Flickr, Wikimedia, museums…), filtered to commercially
// usable licenses, and returns the first real image as a data: URI. Cross-platform (reqwest).
#[tauri::command]
async fn fetch_stock_image(query: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};
    let q = query.trim();
    if q.is_empty() { return Err("empty query".to_string()); }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("adris.tech-desktop/1.0")
        .build().unwrap_or_else(|_| reqwest::Client::new());
    let resp = client
        .get("https://api.openverse.org/v1/images/")
        .query(&[
            ("q", q),
            ("license_type", "commercial"),
            ("page_size", "12"),
            ("mature", "false"),
        ])
        .send().await
        .map_err(|e| format!("image search failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("image search returned {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let results = v["results"].as_array().cloned().unwrap_or_default();
    // Prefer the full image url; fall back to the thumbnail. Try each until one downloads.
    let mut urls: Vec<String> = Vec::new();
    for item in &results {
        if let Some(u) = item["url"].as_str() { urls.push(u.to_string()); }
        if let Some(t) = item["thumbnail"].as_str() { urls.push(t.to_string()); }
    }
    for u in urls.into_iter().take(16) {
        let r = match client.get(&u).send().await { Ok(r) => r, Err(_) => continue };
        if !r.status().is_success() { continue; }
        let ct = r.headers().get(reqwest::header::CONTENT_TYPE)
            .and_then(|h| h.to_str().ok()).unwrap_or("image/jpeg").to_string();
        let ct = ct.split(';').next().unwrap_or("image/jpeg").trim().to_string();
        if !ct.starts_with("image/") { continue; }
        if let Ok(bytes) = r.bytes().await {
            if bytes.len() > 1200 {
                let b64 = general_purpose::STANDARD.encode(&bytes);
                return Ok(format!("data:{};base64,{}", ct, b64));
            }
        }
    }
    Err("no usable image found".to_string())
}

// Persist a generated deck to disk so it lives in the Brain independently of the
// chat (survives chat deletion). Writes <appdata>/decks/<slug>-<ts>.html plus a
// .json sidecar (the DeckSpec, used to re-export .pptx later). Returns the html path.
#[tauri::command]
fn save_deck_files(app: tauri::AppHandle, slug: String, html: String, spec_json: String) -> Result<String, String> {
    use tauri::Manager;
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?.join("decks");
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let safe: String = slug.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' }).collect();
    let safe = if safe.trim_matches('-').is_empty() { "deck".to_string() } else { safe };
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
    let stem = format!("{}-{}", &safe[..safe.len().min(40)], ts);
    let html_path = base.join(format!("{}.html", stem));
    let json_path = base.join(format!("{}.json", stem));
    std::fs::write(&html_path, html).map_err(|e| e.to_string())?;
    std::fs::write(&json_path, spec_json).map_err(|e| e.to_string())?;
    Ok(html_path.to_string_lossy().to_string())
}

// Read the DeckSpec sidecar next to a saved deck html (used by the Brain to
// re-export a .pptx without the chat still being around).
#[tauri::command]
fn read_deck_spec(path: String) -> Result<String, String> {
    let json_path = std::path::Path::new(&path).with_extension("json");
    std::fs::read_to_string(&json_path).map_err(|e| e.to_string())
}

// Open a file/URL with the OS default app. Used by the Brain "Open / Present" action —
// the JS shell plugin's open is scope-restricted and was failing silently on local paths.
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    { std::process::Command::new("cmd").args(["/C", "start", "", &path]).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "macos")]
    { std::process::Command::new("open").arg(&path).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "linux")]
    { std::process::Command::new("xdg-open").arg(&path).spawn().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
async fn sync_token_usage_direct(
    state: tauri::State<'_, SessionKeyState>,
    supabase_url: String,
    supabase_anon_key: String,
    session_token: String,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    let (user_id, pending) = {
        let g = state.0.lock().unwrap();
        match g.as_ref() {
            None => return Ok(()),
            Some(sk) => {
                let p = sk.pending_usage.swap(0, Ordering::SeqCst);
                if p == 0 { return Ok(()); }
                (sk.user_id.clone(), p)
            }
        }
    };
    let _ = reqwest::Client::new()
        .post(format!("{}/rest/v1/token_usage", supabase_url))
        .header("apikey", &supabase_anon_key)
        .header("Authorization", format!("Bearer {}", session_token))
        .header("Content-Type", "application/json")
        .header("Prefer", "return=minimal")
        .json(&serde_json::json!({
            "user_id":         user_id,
            "task_type":       "krew_direct",
            "tokens_consumed": pending,
            "model_used":      "gemini-3-flash-preview",
            "model_tier":      "flash-3-direct",
            "credits_consumed": 0,
        }))
        .send().await;
    Ok(())
}

fn chrono_month_start() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    let days_since_epoch = secs / 86_400;
    // Approximate: find first day of current month using a simple approach
    // We compute year/month from days since epoch (1970-01-01)
    let mut year = 1970u32;
    let mut remaining = days_since_epoch;
    loop {
        let days_in_year = if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) { 366 } else { 365 };
        if remaining < days_in_year { break; }
        remaining -= days_in_year;
        year += 1;
    }
    let mut month = 1u32;
    loop {
        let dim = days_in_month(year, month);
        if remaining < dim as u64 { break; }
        remaining -= dim as u64;
        month += 1;
    }
    format!("{:04}-{:02}-01T00:00:00Z", year, month)
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1|3|5|7|8|10|12 => 31,
        4|6|9|11 => 30,
        2 => if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) { 29 } else { 28 },
        _ => 30,
    }
}

// ─── Krew SQLite DB ───────────────────────────────────────────────────────────

struct KrewDbConn(Mutex<Connection>);

fn init_krew_db(app: &tauri::App) -> rusqlite::Result<Connection> {
    let dir = app.path().app_data_dir().unwrap();
    std::fs::create_dir_all(&dir).ok();
    let conn = Connection::open(dir.join("krew-chat.db"))?;
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS krew_sessions (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL DEFAULT 'New Chat',
            mode        TEXT NOT NULL DEFAULT 'local',
            model       TEXT,
            agent_key   TEXT NOT NULL DEFAULT 'boss',
            created_at  INTEGER NOT NULL,
            last_active INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS krew_messages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT NOT NULL REFERENCES krew_sessions(id) ON DELETE CASCADE,
            role        TEXT NOT NULL,
            content     TEXT NOT NULL,
            tool_name   TEXT,
            created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS krew_summaries (
            session_id   TEXT PRIMARY KEY REFERENCES krew_sessions(id) ON DELETE CASCADE,
            summary      TEXT NOT NULL,
            covers_up_to INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS krew_memory (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_key   TEXT NOT NULL,
            key         TEXT NOT NULL,
            value       TEXT NOT NULL,
            created_at  INTEGER NOT NULL,
            UNIQUE(agent_key, key)
        );
        CREATE TABLE IF NOT EXISTS credentials (
            service TEXT PRIMARY KEY,
            data    TEXT NOT NULL
        );
        PRAGMA foreign_keys = ON;
    ")?;
    // Migrate existing DBs that predate the agent_key column
    conn.execute("ALTER TABLE krew_sessions ADD COLUMN agent_key TEXT NOT NULL DEFAULT 'boss'", []).ok();
    Ok(conn)
}

#[derive(Serialize)]
struct KrewSessionRow {
    id: String, title: String, mode: String, model: Option<String>,
    agent_key: String, created_at: i64, last_active: i64, message_count: i64,
}

#[derive(Serialize)]
struct KrewMessageRow {
    id: i64, session_id: String, role: String,
    content: String, tool_name: Option<String>, created_at: i64,
}

#[tauri::command]
fn db_krew_new_session(
    db: tauri::State<KrewDbConn>,
    title: String,
    mode: String,
    agent_key: String,
    model: Option<String>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let t  = now_secs();
    db.0.lock().unwrap().execute(
        "INSERT INTO krew_sessions (id,title,mode,model,agent_key,created_at,last_active) VALUES (?1,?2,?3,?4,?5,?6,?6)",
        params![id, title, mode, model, agent_key, t],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
fn db_krew_get_sessions(db: tauri::State<KrewDbConn>) -> Result<Vec<KrewSessionRow>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT s.id, s.title, s.mode, s.model, s.agent_key, s.created_at, s.last_active, COUNT(m.id) as cnt
         FROM krew_sessions s LEFT JOIN krew_messages m ON m.session_id=s.id
         GROUP BY s.id ORDER BY s.last_active DESC LIMIT 100"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| Ok(KrewSessionRow {
        id: row.get(0)?, title: row.get(1)?, mode: row.get(2)?,
        model: row.get(3)?, agent_key: row.get(4)?,
        created_at: row.get(5)?, last_active: row.get(6)?, message_count: row.get(7)?,
    })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_krew_update_title(
    db: tauri::State<KrewDbConn>,
    session_id: String,
    title: String,
) -> Result<(), String> {
    db.0.lock().unwrap()
        .execute("UPDATE krew_sessions SET title=?1 WHERE id=?2", params![title, session_id])
        .map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_krew_save_message(
    db: tauri::State<KrewDbConn>,
    session_id: String,
    role: String,
    content: String,
    tool_name: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let t = now_secs();
    conn.execute(
        "INSERT INTO krew_messages (session_id,role,content,tool_name,created_at) VALUES (?1,?2,?3,?4,?5)",
        params![session_id, role, content, tool_name, t],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE krew_sessions SET last_active=?1 WHERE id=?2",
        params![t, session_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_krew_get_messages(
    db: tauri::State<KrewDbConn>,
    session_id: String,
) -> Result<Vec<KrewMessageRow>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id,session_id,role,content,tool_name,created_at FROM krew_messages WHERE session_id=?1 ORDER BY id"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![session_id], |row| Ok(KrewMessageRow {
        id: row.get(0)?, session_id: row.get(1)?, role: row.get(2)?,
        content: row.get(3)?, tool_name: row.get(4)?, created_at: row.get(5)?,
    })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_krew_delete_session(db: tauri::State<KrewDbConn>, session_id: String) -> Result<(), String> {
    db.0.lock().unwrap()
        .execute("DELETE FROM krew_sessions WHERE id=?1", params![session_id])
        .map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_krew_save_summary(
    db: tauri::State<KrewDbConn>,
    session_id: String,
    summary: String,
    covers_up_to: i64,
) -> Result<(), String> {
    db.0.lock().unwrap().execute(
        "INSERT OR REPLACE INTO krew_summaries (session_id,summary,covers_up_to) VALUES (?1,?2,?3)",
        params![session_id, summary, covers_up_to],
    ).map(|_| ()).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct KrewSummaryRow { summary: String, covers_up_to: i64 }

#[tauri::command]
fn db_krew_get_summary(
    db: tauri::State<KrewDbConn>,
    session_id: String,
) -> Result<Option<KrewSummaryRow>, String> {
    let conn = db.0.lock().unwrap();
    let result = conn.query_row(
        "SELECT summary, covers_up_to FROM krew_summaries WHERE session_id=?1",
        params![session_id],
        |row| Ok(KrewSummaryRow { summary: row.get(0)?, covers_up_to: row.get(1)? }),
    );
    match result {
        Ok(r)  => Ok(Some(r)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// ─── Krew memory ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct KrewMemoryRow { id: i64, agent_key: String, key: String, value: String, created_at: i64 }

#[tauri::command]
fn db_krew_save_memory(
    db: tauri::State<KrewDbConn>,
    agent_key: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    db.0.lock().unwrap().execute(
        "INSERT INTO krew_memory (agent_key,key,value,created_at) VALUES (?1,?2,?3,?4)
         ON CONFLICT(agent_key,key) DO UPDATE SET value=excluded.value, created_at=excluded.created_at",
        params![agent_key, key, value, ts],
    ).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_krew_get_memories(
    db: tauri::State<KrewDbConn>,
    agent_key: String,
) -> Result<Vec<KrewMemoryRow>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id,agent_key,key,value,created_at FROM krew_memory WHERE agent_key=?1 ORDER BY created_at ASC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![agent_key], |row| Ok(KrewMemoryRow {
        id: row.get(0)?, agent_key: row.get(1)?, key: row.get(2)?,
        value: row.get(3)?, created_at: row.get(4)?,
    })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_krew_delete_memory(
    db: tauri::State<KrewDbConn>,
    agent_key: String,
    key: String,
) -> Result<(), String> {
    db.0.lock().unwrap()
        .execute("DELETE FROM krew_memory WHERE agent_key=?1 AND key=?2", params![agent_key, key])
        .map(|_| ()).map_err(|e| e.to_string())
}

// ─── Credential storage (OS keychain with SQLite fallback) ───────────────────

const KEYRING_SERVICE: &str = "tech.nivara.desktop";

#[tauri::command]
fn store_credential(
    db: tauri::State<KrewDbConn>,
    service: String,
    data: String,
) -> Result<(), String> {
    // Primary: OS keychain (Windows Credential Manager)
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &service) {
        let _ = entry.set_password(&data);
    }
    // Mirror in SQLite so list_credentials works and as warm fallback
    let _ = db.0.lock().unwrap().execute(
        "INSERT OR REPLACE INTO credentials (service,data) VALUES (?1,?2)",
        params![service, data],
    );
    Ok(())
}

#[tauri::command]
fn get_credential(
    db: tauri::State<KrewDbConn>,
    service: String,
) -> Result<Option<String>, String> {
    // Try keychain first
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &service) {
        if let Ok(data) = entry.get_password() {
            return Ok(Some(data));
        }
    }
    // Fallback: SQLite (pre-v1.0 credentials) — auto-migrate to keychain
    let conn = db.0.lock().unwrap();
    let result = conn.query_row(
        "SELECT data FROM credentials WHERE service=?1",
        params![service],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(d) => {
            if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &service) {
                let _ = entry.set_password(&d);
            }
            Ok(Some(d))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn delete_credential(db: tauri::State<KrewDbConn>, service: String) -> Result<(), String> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &service) {
        let _ = entry.delete_credential();
    }
    db.0.lock().unwrap()
        .execute("DELETE FROM credentials WHERE service=?1", params![service])
        .map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_credentials(db: tauri::State<KrewDbConn>) -> Result<Vec<String>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare("SELECT service FROM credentials ORDER BY service")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ─── Krew tools ───────────────────────────────────────────────────────────────

// ─── Service connection ping ──────────────────────────────────────────────────

#[tauri::command]
async fn ping_service(service_id: String, creds_json: String) -> Result<String, String> {
    let creds: serde_json::Value = serde_json::from_str(&creds_json)
        .map_err(|e| format!("Bad creds JSON: {e}"))?;
    let client = reqwest::Client::builder()
        .user_agent("Nivara/1.0")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    match service_id.as_str() {
        "gemini" => {
            let key = creds["api_key"].as_str().unwrap_or("");
            let url = format!("https://generativelanguage.googleapis.com/v1beta/models?key={key}");
            let r = client.get(&url).send().await.map_err(|e| e.to_string())?;
            if r.status().is_success() { Ok("Connected".into()) }
            else { Err(format!("API key rejected ({})", r.status())) }
        }
        "openai" => {
            let key = creds["api_key"].as_str().unwrap_or("");
            let r = client.get("https://api.openai.com/v1/models")
                .header("Authorization", format!("Bearer {key}"))
                .send().await.map_err(|e| e.to_string())?;
            if r.status().is_success() { Ok("Connected".into()) }
            else { Err(format!("API key rejected ({})", r.status())) }
        }
        "claude" => {
            let key = creds["api_key"].as_str().unwrap_or("");
            let r = client.get("https://api.anthropic.com/v1/models")
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01")
                .send().await.map_err(|e| e.to_string())?;
            if r.status().is_success() { Ok("Connected".into()) }
            else { Err(format!("API key rejected ({})", r.status())) }
        }
        "notion" => {
            let token = creds["token"].as_str().unwrap_or("");
            let r = client.get("https://api.notion.com/v1/users/me")
                .header("Authorization", format!("Bearer {token}"))
                .header("Notion-Version", "2022-06-28")
                .send().await.map_err(|e| e.to_string())?;
            if r.status().is_success() { Ok("Connected".into()) }
            else { Err(format!("Token rejected ({})", r.status())) }
        }
        "slack" => {
            let token = creds["bot_token"].as_str().unwrap_or("");
            let r = client.post("https://slack.com/api/auth.test")
                .header("Authorization", format!("Bearer {token}"))
                .send().await.map_err(|e| e.to_string())?;
            let json: serde_json::Value = r.json().await.map_err(|e| e.to_string())?;
            if json["ok"].as_bool() == Some(true) { Ok("Connected".into()) }
            else { Err(json["error"].as_str().unwrap_or("auth failed").to_string()) }
        }
        "github" => {
            let token = creds["token"].as_str().unwrap_or("");
            let r = client.get("https://api.github.com/user")
                .header("Authorization", format!("token {token}"))
                .send().await.map_err(|e| e.to_string())?;
            if r.status().is_success() { Ok("Connected".into()) }
            else { Err(format!("Token rejected ({})", r.status())) }
        }
        "linear" => {
            let key = creds["api_key"].as_str().unwrap_or("");
            let r = client.post("https://api.linear.app/graphql")
                .header("Authorization", key)
                .header("Content-Type", "application/json")
                .body(r#"{"query":"{ viewer { id } }"}"#)
                .send().await.map_err(|e| e.to_string())?;
            let json: serde_json::Value = r.json().await.map_err(|e| e.to_string())?;
            if json["errors"].is_null() { Ok("Connected".into()) }
            else { Err(json["errors"][0]["message"].as_str().unwrap_or("auth failed").to_string()) }
        }
        "airtable" => {
            let token = creds["token"].as_str().unwrap_or("");
            let r = client.get("https://api.airtable.com/v0/meta/bases")
                .header("Authorization", format!("Bearer {token}"))
                .send().await.map_err(|e| e.to_string())?;
            if r.status().is_success() { Ok("Connected".into()) }
            else { Err(format!("Token rejected ({})", r.status())) }
        }
        "brave" => {
            let key = creds["api_key"].as_str().unwrap_or("");
            let r = client.get("https://api.search.brave.com/res/v1/web/search?q=test")
                .header("Accept", "application/json")
                .header("Accept-Encoding", "gzip")
                .header("X-Subscription-Token", key)
                .send().await.map_err(|e| e.to_string())?;
            if r.status().is_success() { Ok("Connected".into()) }
            else { Err(format!("Key rejected ({})", r.status())) }
        }
        "twitter" => {
            let ak  = creds["api_key"].as_str().unwrap_or("");
            let aks = creds["api_secret"].as_str().unwrap_or("");
            let at  = creds["access_token"].as_str().unwrap_or("");
            let ats = creds["access_token_secret"].as_str().unwrap_or("");
            if ak.is_empty() || aks.is_empty() || at.is_empty() || ats.is_empty() {
                return Err("Missing credentials — reconnect".into());
            }
            // access_token for personal accounts always contains a dash
            if !at.contains('-') {
                return Err("Access Token looks wrong — it should contain a dash".into());
            }
            Ok("Credentials saved — will verify on first post".into())
        }
        "gmail" => {
            let email = creds["email"].as_str().unwrap_or("");
            let pwd   = creds["app_password"].as_str().unwrap_or("");
            if email.is_empty() || pwd.is_empty() {
                return Err("Missing credentials — reconnect".into());
            }
            Ok("Credentials saved — will verify on first use".into())
        }
        "google" | "linkedin" => {
            let cid = creds["client_id"].as_str().unwrap_or("");
            let cs  = creds["client_secret"].as_str().unwrap_or("");
            if cid.is_empty() || cs.is_empty() {
                return Err("Missing credentials — reconnect".into());
            }
            Ok("Credentials saved — will verify on first use".into())
        }
        _ => Err("Unknown service".into()),
    }
}

// ─── Reddit post command ──────────────────────────────────────────────────────

#[tauri::command]
async fn reddit_post(
    subreddit:   String,
    title:       String,
    text:        String,
    client_id:   String,
    client_secret: String,
    username:    String,
    password:    String,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Nivara/1.0 by Nivara-Technologies")
        .build()
        .map_err(|e| e.to_string())?;

    // 1. Get OAuth token via password grant
    let token_resp = client
        .post("https://www.reddit.com/api/v1/access_token")
        .basic_auth(&client_id, Some(&client_secret))
        .form(&[
            ("grant_type", "password"),
            ("username",   &username),
            ("password",   &password),
        ])
        .send().await.map_err(|e| format!("Reddit auth failed: {}", e))?;

    if !token_resp.status().is_success() {
        let body = token_resp.text().await.unwrap_or_default();
        return Err(format!("Reddit auth error: {}", body.chars().take(200).collect::<String>()));
    }

    let token_json: serde_json::Value = token_resp.json().await.map_err(|e| e.to_string())?;
    let access_token = token_json["access_token"].as_str()
        .ok_or("Reddit: no access_token in response")?;

    // 2. Submit the post
    let sub = subreddit.trim_start_matches("r/");
    let submit_resp = client
        .post("https://oauth.reddit.com/api/submit")
        .bearer_auth(access_token)
        .form(&[
            ("api_type", "json"),
            ("kind",     "self"),
            ("sr",       sub),
            ("title",    &title),
            ("text",     &text),
        ])
        .send().await.map_err(|e| format!("Reddit submit failed: {}", e))?;

    let result: serde_json::Value = submit_resp.json().await.map_err(|e| e.to_string())?;

    // Check for API-level errors
    let errors = &result["json"]["errors"];
    if let Some(arr) = errors.as_array() {
        if !arr.is_empty() {
            let msg = arr.iter()
                .filter_map(|e| e[1].as_str())
                .collect::<Vec<_>>().join(", ");
            return Err(format!("Reddit post error: {}", msg));
        }
    }

    let post_url = result["json"]["data"]["url"].as_str().unwrap_or("(no url)").to_string();
    Ok(post_url)
}

#[tauri::command]
async fn krew_web_search(query: String, api_key: String) -> Result<String, String> {
    if api_key.is_empty() {
        return Err("Brave Search API key not configured. Add it in Krew → Connect Apps → Web Search.".to_string());
    }
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.search.brave.com/res/v1/web/search")
        .header("X-Subscription-Token", &api_key)
        .header("Accept", "application/json")
        .query(&[("q", &query), ("count", &"10".to_string())])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let results = json["web"]["results"].as_array().cloned().unwrap_or_default();
    let formatted: Vec<String> = results.iter().map(|r| {
        let title   = r["title"].as_str().unwrap_or("No title");
        let url     = r["url"].as_str().unwrap_or("");
        let snippet = r["description"].as_str().unwrap_or("");
        format!("**{}**\n{}\n{}", title, url, snippet)
    }).collect();
    if formatted.is_empty() {
        return Ok("No results found.".to_string());
    }
    Ok(formatted.join("\n\n---\n\n"))
}

#[tauri::command]
async fn krew_execute_command(command: String) -> Result<String, String> {
    use std::process::Command;
    let output = {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            Command::new("cmd").args(["/C", &command]).creation_flags(0x08000000).output() // CREATE_NO_WINDOW
        }
        #[cfg(not(target_os = "windows"))]
        { Command::new("sh").args(["-c", &command]).output() }
    };
    let out = output.map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let mut result = String::new();
    if !stdout.is_empty() { result.push_str(&stdout); }
    if !stderr.is_empty() {
        if !result.is_empty() { result.push('\n'); }
        result.push_str("[stderr] ");
        result.push_str(&stderr);
    }
    if result.is_empty() { result.push_str("(no output)"); }
    Ok(result)
}

// ── agent-browser: local binary path ─────────────────────────────────────────
fn get_agent_browser_local_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let data_dir = app.path().app_local_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let bin_name = if cfg!(windows) { "agent-browser.exe" } else { "agent-browser" };
    data_dir.join("tools").join(bin_name)
}

// ── Option B: Node.js + playwright-core (system Chrome, no download needed) ──
fn get_playwright_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    let data_dir = app.path().app_local_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    data_dir.join("tools").join("playwright")
}

fn get_playwright_script_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    get_playwright_dir(app).join("agent-browser.js")
}

// ── agent-browser: silent background setup ────────────────────────────────────
#[tauri::command]
async fn setup_agent_browser(app: tauri::AppHandle) -> Result<(), String> {
    tokio::task::spawn(async move {
        // If already in PATH — just ensure Chrome is set up, then return
        let in_path = {
            #[cfg(target_os = "windows")]
            { use std::os::windows::process::CommandExt; std::process::Command::new("agent-browser").arg("--version").creation_flags(0x08000000).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(false) }
            #[cfg(not(target_os = "windows"))]
            { std::process::Command::new("agent-browser").arg("--version").stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(false) }
        };

        let local_bin = get_agent_browser_local_path(&app);
        browser_debug_log(&format!("setup_agent_browser: in_path={} local_bin_exists={}", in_path, local_bin.exists()));

        if !in_path && !local_bin.exists() {
            // Standalone binary — no Node.js needed. This is the path that matters most for a
            // user with no Node installed: without it, browsing silently degrades to a headless
            // text-only fetch and no window ever appears (indistinguishable from "nothing happened"
            // to the user watching their screen). Logged explicitly since a failure here is
            // otherwise invisible — the only symptom is "the agent said it browsed but nothing showed".
            let dl_url = if cfg!(target_os = "windows") {
                "https://github.com/vercel-labs/agent-browser/releases/latest/download/agent-browser-win32-x64.exe"
            } else if cfg!(target_os = "linux") && cfg!(target_arch = "aarch64") {
                "https://github.com/vercel-labs/agent-browser/releases/latest/download/agent-browser-linux-arm64"
            } else if cfg!(target_os = "linux") {
                "https://github.com/vercel-labs/agent-browser/releases/latest/download/agent-browser-linux-x64"
            } else if cfg!(target_arch = "aarch64") {
                "https://github.com/vercel-labs/agent-browser/releases/latest/download/agent-browser-darwin-arm64"
            } else {
                "https://github.com/vercel-labs/agent-browser/releases/latest/download/agent-browser-darwin-x64"
            };
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build().unwrap_or_else(|_| reqwest::Client::new());
            match client.get(dl_url).send().await {
              Ok(resp) if resp.status().is_success() => {
                    match resp.bytes().await {
                      Ok(bytes) => {
                        if let Some(p) = local_bin.parent() { let _ = std::fs::create_dir_all(p); }
                        match std::fs::write(&local_bin, &bytes) {
                          Ok(()) => browser_debug_log(&format!("agent-browser binary downloaded OK ({} bytes) -> {}", bytes.len(), local_bin.display())),
                          Err(e) => browser_debug_log(&format!("agent-browser binary download OK but WRITE FAILED: {}", e)),
                        }
                        #[cfg(unix)] {
                            use std::os::unix::fs::PermissionsExt;
                            let _ = std::fs::set_permissions(&local_bin, std::fs::Permissions::from_mode(0o755));
                        }
                      }
                      Err(e) => browser_debug_log(&format!("agent-browser binary download: response body read FAILED: {}", e)),
                    }
              }
              Ok(resp) => browser_debug_log(&format!("agent-browser binary download FAILED: HTTP {} from {}", resp.status(), dl_url)),
              Err(e) => browser_debug_log(&format!("agent-browser binary download FAILED: {} ({})", e, dl_url)),
            }
        }

        // Option B: Node.js + playwright-core (uses system Chrome — no separate browser download)
        // Always re-write the script so updates deploy to existing installs.
        let script_path = get_playwright_script_path(&app);
        let script_src = include_str!("../../scripts/agent-browser/index.js");
        let needs_setup = !script_path.exists() || {
            // Re-write if the embedded version differs from what's on disk
            std::fs::read_to_string(&script_path).map(|s| s != script_src).unwrap_or(true)
        };
        let node_bin = resolve_node_exe();
        let node_ok = {
            #[cfg(target_os = "windows")]
            { use std::os::windows::process::CommandExt; std::process::Command::new(&node_bin).arg("--version").creation_flags(0x08000000).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(false) }
            #[cfg(not(target_os = "windows"))]
            { std::process::Command::new(&node_bin).arg("--version").stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(false) }
        };

        if node_ok {
            let playwright_dir = get_playwright_dir(&app);
            let _ = std::fs::create_dir_all(&playwright_dir);

            // Deploy/update the wrapper script only when it changed.
            if needs_setup {
                let _ = std::fs::write(&script_path, script_src);
            }

            // Always ensure package.json exists.
            let pkg_json = r#"{"name":"adris-agent-browser","version":"1.0.0","dependencies":{"playwright-core":"1.48.0"}}"#;
            let _ = std::fs::write(playwright_dir.join("package.json"), pkg_json);

            // CRITICAL: install playwright-core whenever it's missing — independent of
            // whether the script changed. Previously this was nested under needs_setup,
            // so installs whose script already matched ended up with no playwright-core
            // and the browser silently never worked.
            let already_installed = playwright_dir.join("node_modules").join("playwright-core").exists();
            if !already_installed {
                let dir_str = playwright_dir.to_string_lossy().to_string();
                #[cfg(target_os = "windows")]
                { use std::os::windows::process::CommandExt; let _ = std::process::Command::new("cmd").args(["/C", &format!("npm install --prefix \"{}\" playwright-core@1.48.0 --save-exact", dir_str)]).creation_flags(0x08000000).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status(); }
                #[cfg(not(target_os = "windows"))]
                { let _ = std::process::Command::new("sh").args(["-c", &format!("npm install --prefix '{}' playwright-core@1.48.0 --save-exact", dir_str)]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status(); }
            }
        }

        // Run 'install' to verify whichever browser backend is available
        if in_path {
            #[cfg(target_os = "windows")]
            { use std::os::windows::process::CommandExt; let _ = std::process::Command::new("agent-browser").arg("install").creation_flags(0x08000000).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status(); }
            #[cfg(not(target_os = "windows"))]
            { let _ = std::process::Command::new("agent-browser").arg("install").stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status(); }
        } else if local_bin.exists() {
            #[cfg(target_os = "windows")]
            { use std::os::windows::process::CommandExt; let _ = std::process::Command::new(&local_bin).arg("install").creation_flags(0x08000000).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status(); }
            #[cfg(not(target_os = "windows"))]
            { let _ = std::process::Command::new(&local_bin).arg("install").stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status(); }
        }
    });
    Ok(())
}

// ── agent-browser: run a command, trying PATH then local binary ───────────────
#[tauri::command]
async fn run_agent_browser(app: tauri::AppHandle, args: String) -> Result<String, String> {
    use std::process::Command;

    let run_cmd = |bin: &str| -> Option<String> {
        let full = format!("{} {}", bin, args);
        let out = {
            #[cfg(target_os = "windows")]
            { use std::os::windows::process::CommandExt; Command::new("cmd").args(["/C", &full]).creation_flags(0x08000000).output().ok()? }
            #[cfg(not(target_os = "windows"))]
            { Command::new("sh").args(["-c", &full]).output().ok()? }
        };
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        // If command wasn't found, return None so we try the local binary
        if stderr.contains("is not recognized") || stderr.contains("not found") || stderr.contains("No such file") { return None; }
        let combined = format!("{}{}", stdout, stderr).trim().to_string();
        Some(if combined.is_empty() { "(done)".to_string() } else { combined })
    };

    if let Some(r) = run_cmd("agent-browser") { return Ok(r); }

    let local_bin = get_agent_browser_local_path(&app);
    if local_bin.exists() {
        if let Some(r) = run_cmd(&format!("\"{}\"", local_bin.display())) { return Ok(r); }
    }

    Ok("[agent-browser not installed]".to_string())
}

// ── Open a URL in the user's actual Chrome/default browser (with their profile & sessions) ──
#[tauri::command]
async fn open_in_system_browser(url: String) -> Result<String, String> {
    use std::process::Command;
    // Sanitise URL — must start with http/https
    let safe_url = if url.starts_with("http://") || url.starts_with("https://") {
        url.clone()
    } else {
        format!("https://{}", url.trim_start_matches('/'))
    };

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        // Try user's Chrome first (opens with their profile/sessions)
        let chrome_paths = [
            format!("{}\\Google\\Chrome\\Application\\chrome.exe",
                std::env::var("PROGRAMFILES").unwrap_or_default()),
            format!("{}\\Google\\Chrome\\Application\\chrome.exe",
                std::env::var("PROGRAMFILES(X86)").unwrap_or_default()),
            format!("{}\\Google\\Chrome\\Application\\chrome.exe",
                std::env::var("LOCALAPPDATA").unwrap_or_default()),
        ];
        for chrome in &chrome_paths {
            if std::path::Path::new(chrome).exists() {
                let _ = Command::new(chrome)
                    .args(["--new-window", &safe_url])
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn();
                return Ok(format!("Opened {} in Chrome", safe_url));
            }
        }
        // Fall back to system default browser
        let _ = Command::new("cmd")
            .args(["/C", "start", "", &safe_url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(&safe_url).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        // Try Chrome / Chromium first (keeps user's login sessions), then fall back to xdg-open
        let linux_chrome_paths = [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
        ];
        for chrome in &linux_chrome_paths {
            if std::path::Path::new(chrome).exists() {
                let _ = Command::new(chrome).args(["--new-window", &safe_url]).spawn();
                return Ok(format!("Opened {} in Chrome", safe_url));
            }
        }
        let _ = Command::new("xdg-open").arg(&safe_url).spawn();
    }
    Ok(format!("Opened {} in your browser", safe_url))
}

// ── agent-browser with per-session isolation (each agent/conversation gets its own Playwright state) ──
#[tauri::command]
async fn run_agent_browser_session(app: tauri::AppHandle, session_id: String, args: String) -> Result<String, String> {
    use std::process::Command;

    // Sanitise session_id for use in path
    let safe_id: String = session_id.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .take(64)
        .collect();
    let session_dir = std::env::temp_dir().join(format!("adris-browser-{}", safe_id));
    let _ = std::fs::create_dir_all(&session_dir);

    let run_cmd = |bin: &str| -> Option<String> {
        let full = format!("{} {}", bin, args);
        let out = {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                Command::new("cmd")
                    .args(["/C", &full])
                    .env("TEMP", &session_dir)
                    .env("TMP",  &session_dir)
                    .creation_flags(0x08000000)
                    .output().ok()?
            }
            #[cfg(not(target_os = "windows"))]
            {
                Command::new("sh")
                    .args(["-c", &full])
                    .env("TMPDIR", &session_dir)
                    .output().ok()?
            }
        };
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        if stderr.contains("is not recognized") || stderr.contains("not found") || stderr.contains("No such file") {
            return None;
        }
        let combined = format!("{}{}", stdout, stderr).trim().to_string();
        Some(if combined.is_empty() { "(done)".to_string() } else { combined })
    };

    if let Some(r) = run_cmd("agent-browser") { return Ok(r); }

    let local_bin = get_agent_browser_local_path(&app);
    if local_bin.exists() {
        if let Some(r) = run_cmd(&format!("\"{}\"", local_bin.display())) { return Ok(r); }
    }

    // Option B: Node.js + playwright-core — same script used by run_browser_persistent.
    // run_agent_browser_session previously had no Node.js fallback, so click/fill/snapshot
    // silently returned "(done)" without doing anything. This adds the missing path.
    let script_path = get_playwright_script_path(&app);
    if script_path.exists() {
        let full = format!("node \"{}\" {}", script_path.display(), args);
        let out = {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                Command::new("cmd")
                    .args(["/C", &full])
                    .env("TEMP", &session_dir)
                    .env("TMP",  &session_dir)
                    .creation_flags(0x08000000)
                    .output().ok()
            }
            #[cfg(not(target_os = "windows"))]
            {
                Command::new("sh")
                    .args(["-c", &full])
                    .env("TMPDIR", &session_dir)
                    .output().ok()
            }
        };
        if let Some(out) = out {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            if !stderr.contains("is not recognized") && !stderr.contains("not found") && !stderr.contains("No such file") {
                let combined = format!("{}{}", stdout, stderr).trim().to_string();
                return Ok(if combined.is_empty() { "(done)".to_string() } else { combined });
            }
        }
    }

    Ok("[agent-browser not installed]".to_string())
}

// ── agent-browser with persistent profile (sessions saved across tasks — user logs in once) ──
// Resolve the Node.js executable path. The agent browser runs via `node agent-browser.js`,
// but a GUI-launched app may NOT have node on PATH (Windows Explorer doesn't reliably pass the
// shell PATH to launched apps), so bare `Command::new("node")` can silently fail — which made
// the status say "opening browser" while no window ever appeared. Try the known install
// locations first, then fall back to bare "node" (PATH) for terminal launches / custom setups.
fn resolve_node_exe() -> String {
    #[cfg(target_os = "windows")]
    {
        let mut candidates: Vec<std::path::PathBuf> = Vec::new();
        if let Ok(pf)   = std::env::var("ProgramFiles")      { candidates.push(std::path::PathBuf::from(pf).join("nodejs").join("node.exe")); }
        if let Ok(pf86) = std::env::var("ProgramFiles(x86)") { candidates.push(std::path::PathBuf::from(pf86).join("nodejs").join("node.exe")); }
        if let Ok(la)   = std::env::var("LOCALAPPDATA")      { candidates.push(std::path::PathBuf::from(la).join("Programs").join("nodejs").join("node.exe")); }
        for c in candidates { if c.is_file() { return c.to_string_lossy().into_owned(); } }
    }
    #[cfg(not(target_os = "windows"))]
    {
        for c in ["/usr/local/bin/node", "/usr/bin/node", "/opt/homebrew/bin/node"] {
            if std::path::Path::new(c).is_file() { return c.to_string(); }
        }
    }
    "node".to_string()
}

// Append a line to the browser debug log so we can see EXACTLY what the agent browser did on
// each call (which path ran, was node found, what came back) instead of guessing. Lives at
// %LOCALAPPDATA%/tech.nivara.desktop/browser-debug.log.
fn browser_debug_log(msg: &str) {
    use std::io::Write;
    let dir = {
        #[cfg(target_os = "windows")]
        { std::env::var("LOCALAPPDATA").ok().map(|p| std::path::PathBuf::from(p).join("tech.nivara.desktop")) }
        #[cfg(not(target_os = "windows"))]
        { std::env::var("HOME").ok().map(|p| std::path::PathBuf::from(p).join(".local").join("share").join("tech.nivara.desktop")) }
    };
    if let Some(d) = dir {
        let _ = std::fs::create_dir_all(&d);
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(d.join("browser-debug.log")) {
            let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|x| x.as_secs()).unwrap_or(0);
            let _ = writeln!(f, "[{}] {}", ts, msg);
        }
    }
}

// Build marker: agent-browser.js v4 (2026-07-02) — `openmany url1|url2|…` batch command:
// opens several URLs as concurrent tabs in the ONE detached Chrome (single process, many
// pages) and returns ===SEP===-delimited text per URL, so the lead tools read in parallel
// instead of ~14s/page serially. No extra window (that mess was separate processes).
// v4.1: openmany non-LinkedIn extraction also surfaces mailto:/tel: hrefs so enrich finds
// emails/phones that live only in link hrefs (parity with the single-page `open` path).
// v4.2: openmany shows the "agent using this window" banner on each batch tab, and reads
// LinkedIn /in/ PROFILE pages via innerText (identity is at the top, not in the feed).
// v4.3: openmany surfaces LinkedIn /in/ result links from search pages (decodes DuckDuckGo/
// Google redirect hrefs) so the browser-based LinkedIn search fallback works when the headless
// HTTP search engines throttle — recovers profiles that exist but were being left blank.
// v4.4: openmany now recognises /company/ pages too (not just /in/) — a lead-table row isn't
// always about a named PERSON (e.g. "find internships" produces rows about ORGANISATIONS with
// no specific contact); reads a company page the same way as a profile (innerText, identity at
// the top) instead of running the feed extractor on it, and the search-result redirect decoder
// surfaces /company/ links too.
// Build marker: agent-browser.js v3 (2026-06-29) — absolute-path node resolution so the
// visible browser opens even when GUI-launched without node on PATH; tool-call stop sequences.
// Build marker: agent-browser.js v2 (2026-06-26) — detached single-window Chrome, clean
// process exit (no CDP hang), class-independent LinkedIn extractor with impressions,
// on-page "agent controlling" banner, faster waits. Bumping this comment forces a
// recompile so include_str! re-embeds the latest scripts/agent-browser/index.js.
#[tauri::command]
async fn run_browser_persistent(app: tauri::AppHandle, args: String) -> Result<String, String> {
    use std::process::Command;
    use std::time::Duration;

    let persistent_dir = {
        #[cfg(target_os = "windows")]
        {
            let local_app = std::env::var("LOCALAPPDATA")
                .unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into_owned());
            std::path::PathBuf::from(local_app).join("adris.tech").join("browser-session")
        }
        #[cfg(not(target_os = "windows"))]
        {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
            std::path::PathBuf::from(home).join(".local").join("share").join("adris-tech").join("browser-session")
        }
    };
    let _ = std::fs::create_dir_all(&persistent_dir);

    // Run browser command in a blocking thread with 30s timeout so it never hangs forever
    let run_with_timeout = |bin: String, args: String, dir: std::path::PathBuf| async move {
        let task = tokio::task::spawn_blocking(move || -> Option<String> {
            let full = format!("{} {}", bin, args);
            let out = {
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    Command::new("cmd")
                        .args(["/C", &full])
                        .env("TEMP", &dir)
                        .env("TMP",  &dir)
                        .creation_flags(0x08000000)
                        .output().ok()?
                }
                #[cfg(not(target_os = "windows"))]
                {
                    Command::new("sh")
                        .args(["-c", &full])
                        .env("TMPDIR", &dir)
                        .output().ok()?
                }
            };
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            if stderr.contains("is not recognized") || stderr.contains("not found") || stderr.contains("No such file") {
                return None; // binary not in this location
            }
            if stderr.contains("Chrome exited") || stderr.contains("DevToolsActivePort") || stderr.contains("failed to launch") {
                return Some("[browser-crash]".to_string());
            }
            let combined = format!("{}{}", stdout, stderr).trim().to_string();
            Some(if combined.is_empty() { "(done)".to_string() } else { combined })
        });
        match tokio::time::timeout(Duration::from_secs(30), task).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Some("[browser-crash]".to_string()),
            Err(_) => Some("[browser-timeout]".to_string()), // 30s elapsed — browser hung
        }
    };

    // PRIMARY: Node.js + playwright-core (our custom agent-browser.js).
    // This is the script we control — single detached Chrome window, persistent
    // logged-in profile, LinkedIn/Reddit extractors, contenteditable typing.
    // It MUST be tried before the generic vercel-labs agent-browser.exe binary,
    // which opens its own windows and has none of our custom logic.
    let script_path = get_playwright_script_path(&app);
    if script_path.exists() {
        // Parse args: "open \"https://url\"" → cmd="open", url="https://url"
        // Use direct Command (not shell) to avoid quoting issues with paths/URLs
        let args_str = args.trim().to_string();
        let mut parts = args_str.splitn(2, ' ');
        let cmd_part = parts.next().unwrap_or("").to_string();
        let url_part = parts.next().unwrap_or("").trim().trim_matches('"').to_string();
        let script_path_clone = script_path.clone();

        let node_task = tokio::task::spawn_blocking(move || -> Option<String> {
            let node_exe = resolve_node_exe();
            browser_debug_log(&format!("node path: cmd='{}' url='{}' node='{}' script='{}'",
                cmd_part, url_part, node_exe, script_path_clone.display()));
            let mut command = std::process::Command::new(&node_exe);
            command.arg(&script_path_clone);
            if !cmd_part.is_empty() { command.arg(&cmd_part); }
            if !url_part.is_empty() { command.arg(&url_part); }

            #[cfg(target_os = "windows")]
            { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }

            let out = match command.output() {
                Ok(o) => o,
                Err(e) => { browser_debug_log(&format!("node spawn FAILED: {} (falling through)", e)); return None; }
            };
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            browser_debug_log(&format!("node done: exit={:?} stdout_len={} stderr={}",
                out.status.code(), stdout.len(), stderr.chars().take(180).collect::<String>()));

            // If node binary not found, skip gracefully
            if stderr.contains("is not recognized") || stderr.contains("not found") || stderr.contains("No such file") {
                return None;
            }
            if stderr.contains("Chrome exited") || stderr.contains("DevToolsActivePort") || stderr.contains("failed to launch") || stderr.contains("Executable doesn't exist") {
                return Some("[browser-crash]".to_string());
            }
            // playwright-core not installed yet
            if stderr.contains("Cannot find module") || stderr.contains("playwright-core not installed") {
                return None;
            }
            let combined = format!("{}{}", stdout, stderr).trim().to_string();
            Some(if combined.is_empty() { "(done)".to_string() } else { combined })
        });

        match tokio::time::timeout(std::time::Duration::from_secs(45), node_task).await {
            Ok(Ok(Some(r))) => { browser_debug_log(&format!("RETURNED via node ({} chars)", r.len())); return Ok(r); }
            Ok(Ok(None))    => browser_debug_log("node path unavailable — trying fallbacks"),
            Ok(Err(_))      => browser_debug_log("node task panicked — trying fallbacks"),
            Err(_)          => browser_debug_log("node path TIMED OUT (45s) — trying fallbacks"),
        }
    } else {
        browser_debug_log(&format!("node script MISSING at '{}' — trying fallbacks", script_path.display()));
    }

    // FALLBACK: generic agent-browser in system PATH (only if our node script is unavailable)
    if let Some(r) = run_with_timeout("agent-browser".to_string(), args.clone(), persistent_dir.clone()).await {
        browser_debug_log("RETURNED via PATH agent-browser fallback");
        return Ok(r);
    }

    // FALLBACK: generic agent-browser.exe bundled binary
    let local_bin = get_agent_browser_local_path(&app);
    if local_bin.exists() {
        if let Some(r) = run_with_timeout(format!("\"{}\"", local_bin.display()), args.clone(), persistent_dir.clone()).await {
            browser_debug_log("RETURNED via bundled agent-browser.exe fallback");
            return Ok(r);
        }
    }

    browser_debug_log("agent-browser NOT INSTALLED — no path worked");
    Ok("[agent-browser not installed]".to_string())
}

// ── Fetch a public web page and return readable text (no browser needed) ─────
fn strip_html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    let mut skip_content = false;
    let mut tag_buf = String::new();
    let chars: Vec<char> = html.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if skip_content {
            if ch == '<' {
                let ahead: String = chars[i+1..].iter().take(8).collect::<String>().to_lowercase();
                if ahead.starts_with("/script") || ahead.starts_with("/style") {
                    skip_content = false; in_tag = true;
                }
            }
            i += 1; continue;
        }
        match ch {
            '<' => { in_tag = true; tag_buf.clear(); }
            '>' => {
                in_tag = false;
                let tl = tag_buf.trim_start().to_lowercase();
                let name = tl.split(|c: char| !c.is_alphabetic()).next().unwrap_or("");
                if name == "script" || name == "style" { skip_content = true; }
                else {
                    match name {
                        "p"|"div"|"br"|"h1"|"h2"|"h3"|"h4"|"h5"|"h6"
                        |"li"|"tr"|"td"|"th"|"section"|"article"|"header"
                        |"footer"|"nav"|"main"|"aside" => out.push('\n'),
                        _ => out.push(' '),
                    }
                }
                tag_buf.clear();
            }
            _ => { if in_tag { tag_buf.push(ch); } else { out.push(ch); } }
        }
        i += 1;
    }
    let mut result = String::new();
    let mut prev_nl = false;
    let mut prev_sp = false;
    for ch in out.chars() {
        match ch {
            '\n' => { if !prev_nl { result.push('\n'); } prev_nl = true; prev_sp = false; }
            c if c.is_ascii_whitespace() => { if !prev_sp && !prev_nl { result.push(' '); } prev_sp = true; }
            c => { result.push(c); prev_nl = false; prev_sp = false; }
        }
    }
    result.replace("&amp;","&").replace("&lt;","<").replace("&gt;",">")
          .replace("&quot;","\"").replace("&nbsp;"," ").replace("&#39;","'")
          .replace("&apos;","'").replace("&hellip;","...").trim().to_string()
}

#[tauri::command]
async fn fetch_page_text(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(5))
        .build().map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| format!("fetch_failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let html = resp.text().await.map_err(|e| e.to_string())?;
    Ok(strip_html_to_text(&html))
}

// ── Read Chrome/Edge browser history (SQLite copy — safe while browser running) ─
#[tauri::command]
async fn read_browser_history(query: String, limit: Option<u32>) -> Result<String, String> {
    let candidates: Vec<std::path::PathBuf> = {
        #[cfg(target_os = "windows")]
        {
            let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
            vec![
                std::path::PathBuf::from(&local).join("Google").join("Chrome").join("User Data").join("Default").join("History"),
                std::path::PathBuf::from(&local).join("Microsoft").join("Edge").join("User Data").join("Default").join("History"),
            ]
        }
        #[cfg(target_os = "linux")]
        {
            let home = std::env::var("HOME").unwrap_or_default();
            vec![
                std::path::PathBuf::from(&home).join(".config").join("google-chrome").join("Default").join("History"),
                std::path::PathBuf::from(&home).join(".config").join("chromium").join("Default").join("History"),
            ]
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        { vec![] }
    };
    let history_path = candidates.into_iter().find(|p| p.exists())
        .ok_or_else(|| "No Chrome or Edge browser history found.".to_string())?;
    // Copy file — Chrome holds a lock on the original while running
    let tmp = std::env::temp_dir().join("adris-hist-tmp.db");
    std::fs::copy(&history_path, &tmp).map_err(|e| format!("Cannot copy history: {e}"))?;
    let lim = limit.unwrap_or(15) as i64;
    let conn = rusqlite::Connection::open_with_flags(
        &tmp, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ).map_err(|e| e.to_string())?;
    let pattern = format!("%{}%", query.to_lowercase());
    let mut stmt = conn.prepare(
        "SELECT url, title, visit_count FROM urls \
         WHERE (lower(url) LIKE ?1 OR lower(title) LIKE ?1) \
         AND url NOT LIKE 'data:%' AND url NOT LIKE 'chrome:%' \
         ORDER BY last_visit_time DESC LIMIT ?2"
    ).map_err(|e| e.to_string())?;
    let rows: Vec<String> = stmt.query_map(
        rusqlite::params![pattern, lim],
        |row| {
            let url: String = row.get(0)?;
            let title: String = row.get(1).unwrap_or_default();
            let visits: i64 = row.get(2).unwrap_or(0);
            Ok(format!("- {} | {} (visited {} times)", title.trim(), url, visits))
        }
    ).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
    let _ = std::fs::remove_file(&tmp);
    if rows.is_empty() {
        Ok(format!("No browser history found matching '{}'. Try a different keyword.", query))
    } else {
        Ok(format!("Browser history for '{}':\n{}", query, rows.join("\n")))
    }
}

#[tauri::command]
async fn krew_http_call(
    method:  String,
    url:     String,
    headers: HashMap<String, String>,
    body:    Option<String>,
) -> Result<String, String> {
    let client  = reqwest::Client::new();
    let mut req = match method.to_uppercase().as_str() {
        "POST"   => client.post(&url),
        "PUT"    => client.put(&url),
        "PATCH"  => client.patch(&url),
        "DELETE" => client.delete(&url),
        _        => client.get(&url),
    };
    for (k, v) in &headers {
        req = req.header(k.as_str(), v.as_str());
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {} — {}", status, text.chars().take(400).collect::<String>()));
    }
    Ok(text)
}

// ─── Generic MCP (Model Context Protocol) transport ──────────────────────────
// Streamable-HTTP transport for talking to ANY MCP server by URL. Unlike
// krew_http_call this exposes the response headers we need for MCP — most
// importantly `mcp-session-id`, which the server issues on `initialize` and
// expects echoed back on every later request. SSE-framed responses (the server
// answers with `text/event-stream` and packs the JSON-RPC reply into `data:`
// lines) are returned raw together with the content-type so the JS layer can
// unwrap them. All JSON-RPC orchestration lives in the TypeScript client.

#[derive(Serialize)]
struct McpHttpResponse {
    status:       u16,
    body:         String,
    session_id:   String,
    content_type: String,
}

#[tauri::command]
async fn mcp_http_call(
    url:        String,
    headers:    HashMap<String, String>,
    body:       String,
    session_id: Option<String>,
) -> Result<McpHttpResponse, String> {
    let client = reqwest::Client::new();
    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream");
    for (k, v) in &headers {
        req = req.header(k.as_str(), v.as_str());
    }
    if let Some(sid) = session_id.as_ref() {
        if !sid.is_empty() {
            req = req.header("Mcp-Session-Id", sid.as_str());
        }
    }
    req = req.body(body);

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let out_session = resp
        .headers()
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .or(session_id)
        .unwrap_or_default();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let text = resp.text().await.unwrap_or_default();
    if status >= 400 {
        return Err(format!("MCP HTTP {} — {}", status, text.chars().take(400).collect::<String>()));
    }
    Ok(McpHttpResponse { status, body: text, session_id: out_session, content_type })
}

// ─── Gmail IMAP ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct EmailSummary {
    uid:     String,
    from:    String,
    subject: String,
    date:    String,
    preview: String,
}

// ─── MIME / email body decoding ──────────────────────────────────────────────

fn qp_decode(input: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        if input[i] == b'=' {
            if i + 1 < input.len() && input[i+1] == b'\n' {
                i += 2; // soft line break
            } else if i + 2 < input.len() && input[i+1] != b'\r' {
                let h = format!("{}{}", input[i+1] as char, input[i+2] as char);
                if let Ok(b) = u8::from_str_radix(&h, 16) {
                    out.push(b); i += 3;
                } else { out.push(b'='); i += 1; }
            } else if i + 3 < input.len() && input[i+1] == b'\r' && input[i+2] == b'\n' {
                i += 3; // soft line break \r\n
            } else { out.push(b'='); i += 1; }
        } else { out.push(input[i]); i += 1; }
    }
    out
}

fn b64_decode_body(input: &str) -> String {
    use base64::{Engine as _, engine::general_purpose};
    let clean: String = input.chars().filter(|c| !c.is_ascii_whitespace()).collect();
    general_purpose::STANDARD.decode(&clean).ok()
        .and_then(|b| String::from_utf8(b).ok())
        .unwrap_or_else(|| input.to_string())
}

fn strip_html(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => { in_tag = false; out.push(' '); }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
       .replace("&nbsp;", " ").replace("&quot;", "\"").replace("&#39;", "'")
}

fn decode_mime_body(raw: &str) -> String {
    let norm = raw.replace("\r\n", "\n");
    let lower = norm.to_lowercase();

    // Multipart: find boundary and extract text/plain
    if lower.contains("content-type: multipart/") || lower.contains("content-type:multipart/") {
        if let Some(bp) = lower.find("boundary=") {
            let bsrc = &norm[bp + 9..];
            let boundary = if bsrc.starts_with('"') {
                bsrc[1..].split('"').next().unwrap_or("").to_string()
            } else {
                bsrc.split(|c: char| c == ';' || c == '\n' || c == '\r')
                    .next().unwrap_or("").trim().to_string()
            };
            if !boundary.is_empty() {
                let delim = format!("--{}", boundary);
                let parts: Vec<&str> = norm.splitn(50, delim.as_str()).collect();
                // First pass: prefer text/plain
                for part in parts.iter().skip(1) {
                    if part.starts_with("--") { continue; }
                    let pl = part.to_lowercase();
                    if pl.contains("content-type: text/plain") || pl.contains("content-type:text/plain") {
                        let body_start = part.find("\n\n").map(|p| p + 2).unwrap_or(0);
                        let body = &part[body_start..];
                        let decoded = if pl.contains("quoted-printable") {
                            String::from_utf8_lossy(&qp_decode(body.as_bytes())).to_string()
                        } else if pl.contains("base64") {
                            b64_decode_body(body)
                        } else { body.to_string() };
                        return decoded;
                    }
                }
                // Second pass: fall back to text/html
                for part in parts.iter().skip(1) {
                    if part.starts_with("--") { continue; }
                    let pl = part.to_lowercase();
                    if pl.contains("content-type: text/html") || pl.contains("content-type:text/html") {
                        let body_start = part.find("\n\n").map(|p| p + 2).unwrap_or(0);
                        let body = &part[body_start..];
                        let decoded = if pl.contains("quoted-printable") {
                            String::from_utf8_lossy(&qp_decode(body.as_bytes())).to_string()
                        } else if pl.contains("base64") {
                            b64_decode_body(body)
                        } else { body.to_string() };
                        return strip_html(&decoded);
                    }
                }
            }
        }
    }

    // Simple (non-multipart): find body after header block
    let header_end = norm.find("\n\n").map(|p| p + 2).unwrap_or(0);
    let headers = &lower[..header_end.min(lower.len())];
    let body = norm[header_end..].trim_start();
    let decoded = if headers.contains("quoted-printable") {
        String::from_utf8_lossy(&qp_decode(body.as_bytes())).to_string()
    } else if headers.contains("content-transfer-encoding: base64") || headers.contains("content-transfer-encoding:base64") {
        b64_decode_body(body)
    } else { body.to_string() };

    if decoded.trim_start().starts_with('<') || decoded.to_lowercase().contains("<html") {
        strip_html(&decoded)
    } else { decoded }
}

#[tauri::command]
async fn gmail_fetch_emails(
    email:       String,
    app_password: String,
    query:       String,
    limit:       u32,
) -> Result<String, String> {
    let email2       = email.clone();
    let app_password2 = app_password.clone();
    let limit2       = limit.max(1).min(50);

    let result = tokio::task::spawn_blocking(move || -> Result<Vec<EmailSummary>, String> {
        let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
        let client = imap::connect(("imap.gmail.com", 993), "imap.gmail.com", &tls)
            .map_err(|e| e.to_string())?;
        let mut sess = client.login(&email2, &app_password2)
            .map_err(|(e, _)| e.to_string())?;

        sess.select("INBOX").map_err(|e| e.to_string())?;

        let q = if query.trim().is_empty() { "ALL".to_string() } else { query.clone() };
        let seq_set = sess.search(&q).map_err(|e| e.to_string())?;
        let mut all_uids: Vec<u32> = seq_set.iter().copied().collect();
        all_uids.sort_unstable();
        let uids: Vec<u32> = all_uids.into_iter().rev().take(limit2 as usize).collect();
        if uids.is_empty() { return Ok(vec![]); }

        let fetch_seq = uids.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
        let messages = sess.fetch(&fetch_seq, "(UID RFC822.HEADER BODY[TEXT]<0.800>)")
            .map_err(|e| e.to_string())?;

        let mut summaries = Vec::new();
        for msg in messages.iter() {
            let uid  = msg.uid.map(|u| u.to_string()).unwrap_or_default();
            let headers_raw = msg.header().unwrap_or(b"");
            let headers_str = String::from_utf8_lossy(headers_raw);
            let preview_raw = msg.text().unwrap_or(b"");
            let preview_decoded = decode_mime_body(&String::from_utf8_lossy(preview_raw));
            let preview = preview_decoded.split_whitespace().collect::<Vec<_>>().join(" ")
                .chars().take(200).collect::<String>();

            let from    = extract_header(&headers_str, "From:");
            let subject = extract_header(&headers_str, "Subject:");
            let date    = extract_header(&headers_str, "Date:");

            summaries.push(EmailSummary { uid, from, subject, date, preview });
        }
        let _ = sess.logout();
        Ok(summaries)
    }).await.map_err(|e| e.to_string())?;

    let emails = result?;
    if emails.is_empty() { return Ok("No emails found matching the search query.".to_string()); }
    let formatted: Vec<String> = emails.iter().map(|e| {
        format!("UID: {}\nFrom: {}\nSubject: {}\nDate: {}\nPreview: {}", e.uid, e.from, e.subject, e.date, e.preview)
    }).collect();
    Ok(formatted.join("\n\n---\n\n"))
}

#[tauri::command]
async fn gmail_fetch_email_body(
    email:       String,
    app_password: String,
    uid:         String,
) -> Result<String, String> {
    let uid_num: u32 = uid.parse().map_err(|_| "Invalid UID".to_string())?;
    let result = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
        let client = imap::connect(("imap.gmail.com", 993), "imap.gmail.com", &tls)
            .map_err(|e| e.to_string())?;
        let mut sess = client.login(&email, &app_password)
            .map_err(|(e, _)| e.to_string())?;
        sess.select("INBOX").map_err(|e| e.to_string())?;
        let messages = sess.uid_fetch(&uid_num.to_string(), "RFC822")
            .map_err(|e| e.to_string())?;
        let raw = messages.iter().next()
            .and_then(|m| m.body())
            .map(|b| String::from_utf8_lossy(b).to_string())
            .unwrap_or_else(|| "Email body not found.".to_string());
        let _ = sess.logout();
        let decoded = decode_mime_body(&raw);
        Ok(decoded.chars().take(6000).collect())
    }).await.map_err(|e| e.to_string())?;
    result
}

fn extract_header(raw: &str, header: &str) -> String {
    for line in raw.lines() {
        if line.to_lowercase().starts_with(&header.to_lowercase()) {
            return line[header.len()..].trim().to_string();
        }
    }
    String::new()
}

// ─── Google OAuth (port 54322) ────────────────────────────────────────────────

static GOOGLE_AUTH_CODE: Mutex<Option<String>> = Mutex::new(None);

#[tauri::command]
fn start_google_oauth_server() -> Result<(), String> {
    *GOOGLE_AUTH_CODE.lock().unwrap() = None;
    std::thread::spawn(|| {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        let listener = match TcpListener::bind("127.0.0.1:54322") {
            Ok(l) => l,
            Err(e) => { *GOOGLE_AUTH_CODE.lock().unwrap() = Some(format!("{{\"error\":\"{}\"}}", e)); return; }
        };
        listener.set_nonblocking(false).ok();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
        loop {
            if std::time::Instant::now() > deadline { break; }
            let Ok((mut stream, _)) = listener.accept() else { continue };
            let mut buf = [0u8; 8192];
            let n = stream.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]);
            let first = req.lines().next().unwrap_or("").to_string();
            let parts: Vec<&str> = first.splitn(3, ' ').collect();
            let path = parts.get(1).copied().unwrap_or("");
            if path.starts_with("/callback") {
                // Extract ?code= from query string
                if let Some(qs) = path.split('?').nth(1) {
                    for param in qs.split('&') {
                        if let Some(code) = param.strip_prefix("code=") {
                            *GOOGLE_AUTH_CODE.lock().unwrap() = Some(format!("{{\"code\":\"{}\"}}", code));
                            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 81\r\n\r\n<html><body><p>Connected to adris.tech. You can close this tab.</p></body></html>");
                            return;
                        }
                    }
                }
                let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
            } else {
                let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn poll_google_auth_code() -> Option<String> {
    GOOGLE_AUTH_CODE.lock().unwrap().take()
}

#[tauri::command]
async fn google_exchange_code(
    client_id: String,
    client_secret: String,
    code: String,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code",          code.as_str()),
            ("client_id",     client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("redirect_uri",  "http://127.0.0.1:54322/callback"),
            ("grant_type",    "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn google_refresh_token(
    client_id: String,
    client_secret: String,
    refresh_token: String,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("refresh_token", refresh_token.as_str()),
            ("client_id",     client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("grant_type",    "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

// ─── LinkedIn OAuth (port 54323) ─────────────────────────────────────────────

static LINKEDIN_AUTH_CODE: Mutex<Option<String>> = Mutex::new(None);

#[tauri::command]
fn start_linkedin_oauth_server() -> Result<(), String> {
    *LINKEDIN_AUTH_CODE.lock().unwrap() = None;
    std::thread::spawn(|| {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        let listener = match TcpListener::bind("127.0.0.1:54323") {
            Ok(l) => l,
            Err(e) => { *LINKEDIN_AUTH_CODE.lock().unwrap() = Some(format!("{{\"error\":\"{}\"}}", e)); return; }
        };
        listener.set_nonblocking(false).ok();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
        loop {
            if std::time::Instant::now() > deadline { break; }
            let Ok((mut stream, _)) = listener.accept() else { continue };
            let mut buf = [0u8; 8192];
            let n = stream.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]);
            let first = req.lines().next().unwrap_or("").to_string();
            let parts: Vec<&str> = first.splitn(3, ' ').collect();
            let path = parts.get(1).copied().unwrap_or("");
            if path.starts_with("/linkedin/callback") {
                if let Some(qs) = path.split('?').nth(1) {
                    for param in qs.split('&') {
                        if let Some(code) = param.strip_prefix("code=") {
                            *LINKEDIN_AUTH_CODE.lock().unwrap() = Some(format!("{{\"code\":\"{}\"}}", code));
                            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 90\r\n\r\n<html><body><p>LinkedIn connected to adris.tech. You can close this tab.</p></body></html>");
                            return;
                        }
                    }
                }
                let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
            } else {
                let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn poll_linkedin_auth_code() -> Option<String> {
    LINKEDIN_AUTH_CODE.lock().unwrap().take()
}

#[tauri::command]
async fn linkedin_exchange_code(
    client_id: String,
    client_secret: String,
    code: String,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://www.linkedin.com/oauth/v2/accessToken")
        .form(&[
            ("grant_type",    "authorization_code"),
            ("code",          code.as_str()),
            ("client_id",     client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("redirect_uri",  "http://127.0.0.1:54323/linkedin/callback"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

// ─── Notion OAuth (port 54324) ────────────────────────────────────────────────

static NOTION_AUTH_CODE: Mutex<Option<String>> = Mutex::new(None);

#[tauri::command]
fn start_notion_oauth_server() -> Result<(), String> {
    *NOTION_AUTH_CODE.lock().unwrap() = None;
    std::thread::spawn(|| {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        let listener = match TcpListener::bind("127.0.0.1:54324") {
            Ok(l) => l,
            Err(e) => { *NOTION_AUTH_CODE.lock().unwrap() = Some(format!("{{\"error\":\"{}\"}}", e)); return; }
        };
        listener.set_nonblocking(false).ok();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
        loop {
            if std::time::Instant::now() > deadline { break; }
            let Ok((mut stream, _)) = listener.accept() else { continue };
            let mut buf = [0u8; 8192];
            let n = stream.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]);
            let first = req.lines().next().unwrap_or("").to_string();
            let parts: Vec<&str> = first.splitn(3, ' ').collect();
            let path = parts.get(1).copied().unwrap_or("");
            if path.starts_with("/callback") {
                if let Some(qs) = path.split('?').nth(1) {
                    for param in qs.split('&') {
                        if let Some(code) = param.strip_prefix("code=") {
                            *NOTION_AUTH_CODE.lock().unwrap() = Some(format!("{{\"code\":\"{}\"}}", code));
                            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 81\r\n\r\n<html><body><p>Connected to adris.tech. You can close this tab.</p></body></html>");
                            return;
                        }
                    }
                }
                let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
            } else {
                let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn poll_notion_auth_code() -> Option<String> {
    NOTION_AUTH_CODE.lock().unwrap().take()
}

#[tauri::command]
async fn notion_exchange_code(
    client_id: String,
    client_secret: String,
    code: String,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let creds = format!("{}:{}", client_id, client_secret);
    use base64::{Engine as _, engine::general_purpose};
    let encoded = general_purpose::STANDARD.encode(creds.as_bytes());
    let resp = client
        .post("https://api.notion.com/v1/oauth/token")
        .header("Authorization", format!("Basic {}", encoded))
        .header("Content-Type", "application/json")
        .header("Notion-Version", "2022-06-28")
        .json(&serde_json::json!({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": "http://127.0.0.1:54324/callback"
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

// ─── Gemini vision: parse [IMAGE:mimeType:base64] markers in message content ──
fn parse_gemini_parts(content: &str) -> Vec<serde_json::Value> {
    let mut parts: Vec<serde_json::Value> = Vec::new();
    let marker = "[IMAGE:";
    let mut pos = 0;
    while pos < content.len() {
        if let Some(rel) = content[pos..].find(marker) {
            let start = pos + rel;
            let text_before = content[pos..start].trim();
            if !text_before.is_empty() {
                parts.push(serde_json::json!({ "text": text_before }));
            }
            let after = start + marker.len();
            if let Some(colon) = content[after..].find(':') {
                let mime = &content[after..after + colon];
                let data_start = after + colon + 1;
                if let Some(end_bracket) = content[data_start..].find(']') {
                    let base64_data = &content[data_start..data_start + end_bracket];
                    parts.push(serde_json::json!({
                        "inline_data": { "mime_type": mime, "data": base64_data }
                    }));
                    pos = data_start + end_bracket + 1;
                    continue;
                }
            }
            // Malformed marker — include remaining as text
            let tail = content[start..].trim();
            if !tail.is_empty() { parts.push(serde_json::json!({ "text": tail })); }
            break;
        } else {
            let tail = content[pos..].trim();
            if !tail.is_empty() { parts.push(serde_json::json!({ "text": tail })); }
            break;
        }
    }
    if parts.is_empty() { parts.push(serde_json::json!({ "text": content })); }
    parts
}

// Strip [IMAGE:...] markers for providers that don't support vision
fn strip_image_markers(content: &str) -> String {
    let mut result = String::new();
    let mut remaining = content;
    while let Some(start) = remaining.find("[IMAGE:") {
        result.push_str(&remaining[..start]);
        result.push_str("[image attached]");
        if let Some(end) = remaining[start..].find(']') {
            remaining = &remaining[start + end + 1..];
        } else {
            break;
        }
    }
    result.push_str(remaining);
    result
}

// ─── Extended ai_stream with system_prompt support ────────────────────────────

#[tauri::command]
async fn krew_ai_stream(
    app: tauri::AppHandle,
    call_id: String,
    mode: String,
    system_prompt: Option<String>,
    messages: Vec<AiMessage>,
    api_key: Option<String>,
    provider: Option<String>,
    _local_model: Option<String>,
    model_name: Option<String>,
    base_url: Option<String>,
    session_token: Option<String>,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let cid = call_id.clone();
    let emit_chunk = { let app = app.clone(); move |t: String| { let _ = app.emit("krew-chunk", serde_json::json!({ "id": cid, "text": t })); } };
    let cid = call_id.clone();
    let emit_done  = { let app = app.clone(); move || { let _ = app.emit("krew-done",  serde_json::json!({ "id": cid })); } };
    let cid = call_id.clone();
    let emit_error = { let app = app.clone(); move |e: String| { let _ = app.emit("krew-error", serde_json::json!({ "id": cid, "error": e })); } };

    let sys = system_prompt.unwrap_or_default();

    match mode.as_str() {
        "local" => {
            // adris-engine (llama.cpp) serves OpenAI-compatible API on port 8080
            let mut all_msgs = Vec::new();
            if !sys.is_empty() { all_msgs.push(serde_json::json!({"role":"system","content":sys})); }
            for m in &messages { all_msgs.push(serde_json::json!({"role":m.role,"content":m.content})); }
            let body = serde_json::json!({ "model": "local", "messages": all_msgs, "stream": true });
            let resp = reqwest::Client::new()
                .post("http://127.0.0.1:8080/v1/chat/completions")
                .json(&body).send().await
                .map_err(|e| { let s = format!("Local AI engine not running. Load a model first in the Models tab. ({})", e); emit_error(s.clone()); s })?;
            let mut stream = resp.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let bytes = chunk.map_err(|e| e.to_string())?;
                for line in String::from_utf8_lossy(&bytes).lines() {
                    if let Some(data) = line.strip_prefix("data: ") {
                        if data.trim() == "[DONE]" { emit_done(); return Ok(()); }
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(t) = v["choices"][0]["delta"]["content"].as_str() {
                                if !t.is_empty() { emit_chunk(t.to_string()); }
                            }
                        }
                    }
                }
            }
            emit_done();
        }
        "own_key" => {
            let key  = api_key.unwrap_or_default();
            let prov = provider.unwrap_or_else(|| "openai".to_string());
            if prov == "claude" {
                let model = model_name.unwrap_or_else(|| "claude-3-5-haiku-20241022".to_string());
                let clean_msgs: Vec<serde_json::Value> = messages.iter().map(|m| serde_json::json!({
                    "role": m.role, "content": strip_image_markers(&m.content)
                })).collect();
                let mut body = serde_json::json!({ "model": model, "max_tokens": 4096, "stream": true, "messages": clean_msgs, "stop_sequences": ["</tool_call>", "</tool_code>"] });
                if !sys.is_empty() { body["system"] = serde_json::Value::String(sys); }
                let resp = reqwest::Client::new().post("https://api.anthropic.com/v1/messages")
                    .header("x-api-key", &key).header("anthropic-version", "2023-06-01")
                    .header(header::CONTENT_TYPE, "application/json").json(&body).send().await
                    .map_err(|e| { let s = e.to_string(); emit_error(s.clone()); s })?;
                let mut stream = resp.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    for line in String::from_utf8_lossy(&chunk.map_err(|e| e.to_string())?).lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            if data == "[DONE]" { emit_done(); return Ok(()); }
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                                if v["type"] == "content_block_delta" {
                                    if let Some(t) = v["delta"]["text"].as_str() { emit_chunk(t.to_string()); }
                                }
                            }
                        }
                    }
                }
                emit_done();
            } else if prov == "gemini" {
                let model = model_name.unwrap_or_else(|| "gemini-2.5-flash-lite".to_string());
                let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?key={}&alt=sse", model, key);
                let gemini_msgs: Vec<serde_json::Value> = messages.iter().map(|m| serde_json::json!({
                    "role": if m.role == "assistant" { "model" } else { "user" },
                    "parts": parse_gemini_parts(&m.content)
                })).collect();
                // Stop at a closed tool call so the model can't fabricate the tool result.
                let mut body = serde_json::json!({ "contents": gemini_msgs, "generationConfig": { "stopSequences": ["</tool_call>", "</tool_code>"] } });
                if !sys.is_empty() { body["systemInstruction"] = serde_json::json!({"parts":[{"text":sys}]}); }
                let resp = reqwest::Client::new().post(&url).json(&body).send().await
                    .map_err(|e| { let s = e.to_string(); emit_error(s.clone()); s })?;
                if !resp.status().is_success() {
                    let status = resp.status();
                    let body_text = resp.text().await.unwrap_or_default();
                    let msg = if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body_text) {
                        v["error"]["message"].as_str().unwrap_or(&body_text).chars().take(300).collect::<String>()
                    } else { body_text.chars().take(300).collect::<String>() };
                    emit_error(format!("Gemini error ({}): {}", status.as_u16(), msg));
                    return Ok(());
                }
                let mut stream = resp.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    for line in String::from_utf8_lossy(&chunk.map_err(|e| e.to_string())?).lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                                // Skip thinking-mode parts (gemini-2.5-flash and above)
                                if let Some(parts) = v["candidates"][0]["content"]["parts"].as_array() {
                                    for part in parts {
                                        if part["thought"].as_bool() == Some(true) { continue; }
                                        if let Some(t) = part["text"].as_str() { emit_chunk(t.to_string()); }
                                    }
                                }
                                if v["candidates"][0]["finishReason"].as_str() == Some("SAFETY") {
                                    emit_error("Response blocked by Gemini safety filters.".to_string());
                                    return Ok(());
                                }
                            }
                        }
                    }
                }
                emit_done();
            } else {
                let endpoint = base_url.unwrap_or_else(|| match prov.as_str() {
                    "openai"     => "https://api.openai.com/v1/chat/completions",
                    "groq"       => "https://api.groq.com/openai/v1/chat/completions",
                    "mistral"    => "https://api.mistral.ai/v1/chat/completions",
                    "perplexity" => "https://api.perplexity.ai/chat/completions",
                    "together"   => "https://api.together.xyz/v1/chat/completions",
                    "deepseek"   => "https://api.deepseek.com/v1/chat/completions",
                    _            => "https://api.openai.com/v1/chat/completions",
                }.to_string());
                let model = model_name.unwrap_or_else(|| "gpt-4o".to_string());
                let mut all_msgs: Vec<serde_json::Value> = Vec::new();
                if !sys.is_empty() { all_msgs.push(serde_json::json!({"role":"system","content":sys})); }
                for m in &messages { all_msgs.push(serde_json::json!({"role":m.role,"content":strip_image_markers(&m.content)})); }
                let body = serde_json::json!({ "model": model, "messages": all_msgs, "stream": true, "stop": ["</tool_call>", "</tool_code>"] });
                let resp = reqwest::Client::new().post(&endpoint)
                    .header(header::AUTHORIZATION, format!("Bearer {}", key))
                    .header(header::CONTENT_TYPE, "application/json").json(&body).send().await
                    .map_err(|e| { let s = e.to_string(); emit_error(s.clone()); s })?;
                if !resp.status().is_success() {
                    let e = format!("{} — {}", resp.status(), resp.text().await.unwrap_or_default().chars().take(200).collect::<String>());
                    emit_error(e); return Ok(());
                }
                let mut stream = resp.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    for line in String::from_utf8_lossy(&chunk.map_err(|e| e.to_string())?).lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            if data.trim() == "[DONE]" { emit_done(); return Ok(()); }
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                                if let Some(t) = v["choices"][0]["delta"]["content"].as_str() { if !t.is_empty() { emit_chunk(t.to_string()); } }
                            }
                        }
                    }
                }
                emit_done();
            }
        }
        "nivara" => {
            let token = session_token.unwrap_or_default();
            if token.is_empty() {
                emit_error("Sign in to adris.tech to use adris.tech AI.".to_string());
                return Ok(());
            }
            let emit_truncated = { let app = app.clone(); let cid = call_id.clone(); move || { let _ = app.emit("krew-truncated", serde_json::json!({ "id": cid })); } };
            // Fast path: use session key for direct Gemini call (no Edge Function overhead)
            let sk_arc = {
                let st = app.state::<SessionKeyState>();
                let g = st.0.lock().unwrap();
                g.as_ref().and_then(|a| {
                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default().as_millis() as i64;
                    if a.expires_at > now_ms && a.remaining.load(std::sync::atomic::Ordering::Relaxed) > 0 {
                        Some(a.clone())
                    } else { None }
                })
            };
            if let Some(sk) = sk_arc {
                let gkey = sk.key.get();
                let url = format!("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?key={}&alt=sse", gkey);
                let contents: Vec<serde_json::Value> = messages.iter().map(|m| serde_json::json!({
                    "role": if m.role == "assistant" { "model" } else { "user" },
                    "parts": parse_gemini_parts(&m.content)
                })).collect();
                // stopSequences halt generation the instant a tool call closes, so the model
                // cannot keep going and HALLUCINATE the tool's result (the bug that produced
                // fake leads and a browser that "ran" without ever opening). The agent loop
                // then executes the real tool and feeds back the real result.
                let mut body = serde_json::json!({ "contents": contents, "generationConfig": { "maxOutputTokens": 32768, "stopSequences": ["</tool_call>", "</tool_code>"] } });
                if !sys.is_empty() { body["systemInstruction"] = serde_json::json!({"parts":[{"text": sys}]}); }
                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(120))
                    .build().unwrap_or_else(|_| reqwest::Client::new());
                let resp = client.post(&url).json(&body).send().await
                    .map_err(|e| { let s = e.to_string(); emit_error(s.clone()); s })?;
                if !resp.status().is_success() {
                    let st = resp.status(); let eb = resp.text().await.unwrap_or_default();
                    emit_error(format!("{} — {}", st, eb.chars().take(300).collect::<String>()));
                    return Ok(());
                }
                let mut chars = 0i64;
                let mut api_total_tokens: Option<i64> = None; // usageMetadata.totalTokenCount (input + output)
                let mut stream = resp.bytes_stream();
                'outer_krew: while let Some(chunk) = stream.next().await {
                    // A network hiccup mid-stream must NOT discard the partial answer or drop
                    // the token count on the floor. If a chunk errors, mark the reply truncated,
                    // bill exactly what was used so far (below), and end the turn CLEANLY — the
                    // user sees a coherent (if shorter) reply instead of a frozen/garbled one
                    // that still cost tokens with nothing to show for it.
                    let bytes = match chunk {
                        Ok(b) => b,
                        Err(_) => { emit_truncated(); break 'outer_krew; }
                    };
                    for line in String::from_utf8_lossy(&bytes).lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                                // Capture accurate total token count (input + output) from Gemini metadata
                                if let Some(t) = v["usageMetadata"]["totalTokenCount"].as_i64() {
                                    api_total_tokens = Some(t);
                                }
                                if let Some(parts) = v["candidates"][0]["content"]["parts"].as_array() {
                                    for part in parts {
                                        if part["thought"].as_bool() == Some(true) { continue; }
                                        if let Some(t) = part["text"].as_str() {
                                            if !t.is_empty() { chars += t.len() as i64; emit_chunk(t.to_string()); }
                                        }
                                    }
                                }
                                let fin = v["candidates"][0]["finishReason"].as_str().unwrap_or("");
                                if fin == "MAX_TOKENS" { emit_truncated(); }
                                if fin == "STOP" || fin == "MAX_TOKENS" {
                                    let toks = api_total_tokens.unwrap_or_else(|| (chars / 4).max(1));
                                    sk.pending_usage.fetch_add(toks, std::sync::atomic::Ordering::Relaxed);
                                    sk.remaining.fetch_sub(toks, std::sync::atomic::Ordering::Relaxed);
                                    let _ = app.emit("nivara-tokens", serde_json::json!({ "tokens": toks }));
                                    emit_done(); return Ok(());
                                }
                                if v["candidates"][0]["finishReason"].is_string() { break 'outer_krew; }
                            }
                        }
                    }
                }
                let toks = api_total_tokens.unwrap_or_else(|| (chars / 4).max(1));
                sk.pending_usage.fetch_add(toks, std::sync::atomic::Ordering::Relaxed);
                sk.remaining.fetch_sub(toks, std::sync::atomic::Ordering::Relaxed);
                let _ = app.emit("nivara-tokens", serde_json::json!({ "tokens": toks }));
                emit_done();
            } else {
                // Fallback: route via krew-stream Edge Function
                let fn_url = "https://xkkqcqsacgdrfwbwdqsp.supabase.co/functions/v1/krew-stream";
                let body = serde_json::json!({ "messages": messages, "systemPrompt": sys, "stopSequences": ["</tool_call>", "</tool_code>"] });
                // HTTP/1.1 only — avoids HTTP/2 ALPN negotiation issues on some Windows TLS configs
                let client = reqwest::Client::builder()
                    .http1_only()
                    .timeout(std::time::Duration::from_secs(120))
                    .build().unwrap_or_else(|_| reqwest::Client::new());
                let resp = client
                    .post(fn_url)
                    .header("Authorization", format!("Bearer {}", token))
                    .header(header::CONTENT_TYPE, "application/json")
                    .json(&body).send().await
                    .map_err(|e| { let s = e.to_string(); emit_error(s.clone()); s })?;
                if !resp.status().is_success() {
                    let status = resp.status();
                    let body_text = resp.text().await.unwrap_or_default();
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body_text) {
                        // krew-stream returns {"error":"..."}, Supabase gateway returns {"message":"..."}
                        let err_msg = v["error"].as_str()
                            .or_else(|| v["message"].as_str())
                            .or_else(|| v["msg"].as_str());
                        if let Some(e) = err_msg { emit_error(e.to_string()); return Ok(()); }
                    }
                    emit_error(format!("{} — {}", status, body_text.chars().take(300).collect::<String>()));
                    return Ok(());
                }
                // Estimate input tokens up-front (prompt + system) so edge-fallback usage is
                // counted too — the fast path uses exact usageMetadata, but the krew-stream SSE
                // only sends text chunks, so we approximate (~4 chars/token). Emitting
                // nivara-tokens lets the app's usage listener record it (the "% never moves" fix
                // when the managed key can't load and everything runs on this fallback).
                let input_chars: i64 = sys.len() as i64
                    + messages.iter().map(|m| m.content.len() as i64).sum::<i64>();
                let mut out_chars = 0i64;
                let bill = { let app = app.clone(); move |extra: i64| {
                    let toks = ((input_chars + extra) / 4).max(1);
                    let _ = app.emit("nivara-tokens", serde_json::json!({ "tokens": toks }));
                }};
                let mut stream = resp.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    let bytes = chunk.map_err(|e| { let s = format!("Stream interrupted: {}", e); emit_error(s.clone()); s })?;
                    for line in String::from_utf8_lossy(&bytes).lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            if data == "[DONE]" { bill(out_chars); emit_done(); return Ok(()); }
                            if data == "[TRUNCATED]" { emit_truncated(); continue; }
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                                if let Some(t) = v["text"].as_str() { if !t.is_empty() { out_chars += t.len() as i64; emit_chunk(t.to_string()); } }
                            }
                        }
                    }
                }
                bill(out_chars);
                emit_done();
            }
        }
        _ => emit_error(format!("Unknown mode: {}", mode)),
    }
    Ok(())
}

// ─── Tray + window ───────────────────────────────────────────────────────────

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let open         = MenuItem::with_id(app, "open",         "Open adris.tech",    true,  None::<&str>)?;
    let sep1         = tauri::menu::PredefinedMenuItem::separator(app)?;
    let vault_info   = MenuItem::with_id(app, "vault_info",   "Vault: Off",     false, None::<&str>)?;
    let vault_toggle = MenuItem::with_id(app, "vault_toggle", "Enable Vault DNS", true, None::<&str>)?;
    let sep2         = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit         = MenuItem::with_id(app, "quit",         "Quit adris.tech",    true,  None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &sep1, &vault_info, &vault_toggle, &sep2, &quit])?;

    // Store vault_toggle so update_tray_vault can update its text without rebuilding the menu
    app.manage(TrayState { vault_toggle: Mutex::new(Some(vault_toggle)) });

    let icon = app.default_window_icon().cloned()
        .unwrap_or_else(|| tauri::include_image!("icons/32x32.png"));
    TrayIconBuilder::with_id("main-tray")
        .icon(icon).menu(&menu).show_menu_on_left_click(false)
        .tooltip("Vault: Off · adris.tech")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "open" => show_main_window(app),
            "vault_toggle" => {
                let should_enable = {
                    let vs = app.state::<VaultState>();
                    let val = !*vs.enabled.lock().unwrap();
                    val
                };
                let app2 = app.clone();
                std::thread::spawn(move || {
                    let vs = app2.state::<VaultState>();
                    if should_enable {
                        let requested = vs.mode.lock().unwrap().clone();
                        // Use the SAME safe enable as the UI — pre-checks DNS reachability and
                        // never strands the machine offline (the disconnect bug).
                        match safe_vault_enable(&app2, &vs, &requested) {
                            Ok(res) => {
                                let _ = app2.emit("vault_state_changed", serde_json::json!({
                                    "enabled": true, "mode": res.active_mode, "adapter": res.adapter,
                                    "failover_used": res.failover_used
                                }));
                            }
                            Err(err) => {
                                let _ = app2.emit("vault_state_changed", serde_json::json!({
                                    "enabled": false, "mode": requested, "adapter": null, "error": err
                                }));
                            }
                        }
                    } else {
                        let (adapter, mode) = {
                            let a = vs.adapter.lock().unwrap().clone().unwrap_or_else(get_active_adapter);
                            let m = vs.mode.lock().unwrap().clone();
                            (a, m)
                        };
                        if revert_dns(&adapter).is_ok() {
                            *vs.enabled.lock().unwrap() = false;
                            save_vault_state(&app2, false, &mode, &adapter);
                            update_tray_vault(&app2, false, &mode);
                            let _ = app2.emit("vault_state_changed", serde_json::json!({
                                "enabled": false, "mode": mode, "adapter": adapter
                            }));
                        }
                    }
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// ─── Automation Trigger Engine ────────────────────────────────────────────────

use std::sync::atomic::{AtomicBool, Ordering};

struct TriggerState(Mutex<HashMap<String, Arc<AtomicBool>>>);

/// Spawn the right background task for a given trigger type.
/// Does nothing if trigger_type is unknown or config is invalid.
async fn spawn_trigger(
    app: &tauri::AppHandle,
    automation_id: String,
    trigger_type: String,
    trigger_config: String,
    flag: Arc<AtomicBool>,
) {
    let cfg: serde_json::Value = serde_json::from_str(&trigger_config).unwrap_or_default();
    match trigger_type.as_str() {
        "schedule" => {
            let cron_str = cfg["cron"].as_str().unwrap_or("0 9 * * *").to_string();
            let aid = automation_id.clone();
            let app2 = app.clone();
            tokio::spawn(run_schedule_trigger(cron_str, aid, app2, flag));
        }
        "file_watch" => {
            let folder = cfg["folder"].as_str().unwrap_or("").to_string();
            if !folder.is_empty() {
                let aid = automation_id.clone();
                let app2 = app.clone();
                tokio::task::spawn_blocking(move || {
                    run_file_watch_trigger_blocking(folder, aid, app2, flag);
                });
            }
        }
        "email" => {
            let aid = automation_id.clone();
            let app2 = app.clone();
            tokio::spawn(run_email_poll_trigger(aid, app2, flag));
        }
        "webhook" => {
            let path = cfg["webhook_path"].as_str().unwrap_or("/webhook").to_string();
            let aid = automation_id.clone();
            let app2 = app.clone();
            tokio::task::spawn_blocking(move || {
                run_webhook_trigger_blocking(path, aid, app2, flag);
            });
        }
        // Canvas flows carry their trigger node's intent at the top level of the
        // config (lifted at save time), so they can run automatically in the
        // background just like form automations — then executeAutomation routes
        // the fire to the canvas graph executor.
        "canvas_flow" => {
            match cfg["triggerType"].as_str().unwrap_or("schedule") {
                "schedule" => {
                    let cron_str = cfg["cron"].as_str().unwrap_or("0 9 * * *").to_string();
                    tokio::spawn(run_schedule_trigger(cron_str, automation_id.clone(), app.clone(), flag));
                }
                "email" => {
                    tokio::spawn(run_email_poll_trigger(automation_id.clone(), app.clone(), flag));
                }
                "file_watch" => {
                    let folder = cfg["folder"].as_str().unwrap_or("").to_string();
                    if !folder.is_empty() {
                        let aid = automation_id.clone();
                        let app2 = app.clone();
                        tokio::task::spawn_blocking(move || run_file_watch_trigger_blocking(folder, aid, app2, flag));
                    }
                }
                "webhook" => {
                    let path = cfg["webhook_path"].as_str().unwrap_or("/webhook").to_string();
                    let aid = automation_id.clone();
                    let app2 = app.clone();
                    tokio::task::spawn_blocking(move || run_webhook_trigger_blocking(path, aid, app2, flag));
                }
                _ => {} // rss/github/calendar/stripe/twitter have no background poller — run via "Run now"
            }
        }
        _ => {}
    }
}

// ─── Schedule (cron) ──────────────────────────────────────────────────────────

async fn run_schedule_trigger(
    cron_str: String,
    automation_id: String,
    app: tauri::AppHandle,
    flag: Arc<AtomicBool>,
) {
    use chrono::Utc;
    use cron::Schedule;
    use std::str::FromStr;

    // `cron` crate uses 6-field: sec min hour dom month dow
    // Frontend sends 5-field: min hour dom month dow → prepend "0 "
    let full_cron = format!("0 {}", cron_str.trim());
    let Ok(schedule) = Schedule::from_str(&full_cron) else { return; };

    while flag.load(Ordering::Relaxed) {
        let now = Utc::now();
        let Some(next) = schedule.upcoming(Utc).next() else { break; };
        let wait_secs = (next - now).num_seconds().max(0) as u64;

        // Sleep 1s at a time so we can notice cancellations
        for _ in 0..wait_secs {
            if !flag.load(Ordering::Relaxed) { return; }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
        if !flag.load(Ordering::Relaxed) { break; }

        let _ = app.emit("automation_fired", serde_json::json!({
            "id": automation_id,
            "trigger_type": "schedule",
            "context": format!("Scheduled at {}", next.format("%Y-%m-%d %H:%M UTC")),
        }));
    }
}

// ─── File watch (notify) ─────────────────────────────────────────────────────

fn run_file_watch_trigger_blocking(
    folder: String,
    automation_id: String,
    app: tauri::AppHandle,
    flag: Arc<AtomicBool>,
) {
    use notify::{RecursiveMode, Watcher};
    use notify::event::{CreateKind, EventKind};

    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = match notify::recommended_watcher(move |res| { let _ = tx.send(res); }) {
        Ok(w) => w,
        Err(_) => return,
    };
    if watcher.watch(std::path::Path::new(&folder), RecursiveMode::NonRecursive).is_err() {
        return;
    }

    while flag.load(Ordering::Relaxed) {
        match rx.recv_timeout(std::time::Duration::from_secs(1)) {
            Ok(Ok(event)) if matches!(event.kind, EventKind::Create(CreateKind::File)) => {
                for path in &event.paths {
                    let ctx = format!("New file: {}", path.display());
                    let _ = app.emit("automation_fired", serde_json::json!({
                        "id": automation_id,
                        "trigger_type": "file_watch",
                        "context": ctx,
                    }));
                }
            }
            _ => {}
        }
    }
}

// ─── Email poll (every 2 minutes) ─────────────────────────────────────────────

async fn run_email_poll_trigger(
    automation_id: String,
    app: tauri::AppHandle,
    flag: Arc<AtomicBool>,
) {
    const INTERVAL_SECS: u64 = 120;
    while flag.load(Ordering::Relaxed) {
        for _ in 0..INTERVAL_SECS {
            if !flag.load(Ordering::Relaxed) { return; }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
        if !flag.load(Ordering::Relaxed) { break; }
        let _ = app.emit("automation_fired", serde_json::json!({
            "id": automation_id,
            "trigger_type": "email",
            "context": "",
        }));
    }
}

// ─── Webhook (single TCP listener on port 3141) ────────────────────────────────

fn run_webhook_trigger_blocking(
    webhook_path: String,
    automation_id: String,
    app: tauri::AppHandle,
    flag: Arc<AtomicBool>,
) {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let listener = match TcpListener::bind("127.0.0.1:3141") {
        Ok(l) => l,
        Err(_) => return,
    };
    listener.set_nonblocking(true).ok();

    while flag.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buf = [0u8; 16384];
                let n = stream.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let first_line = req.lines().next().unwrap_or("").to_string();
                let path = first_line.splitn(3, ' ').nth(1).unwrap_or("").to_string();

                if path.starts_with(&webhook_path) || path == webhook_path {
                    let body = if let Some(sep) = req.find("\r\n\r\n") {
                        req[sep + 4..].trim().to_string()
                    } else { String::new() };

                    let _ = app.emit("automation_fired", serde_json::json!({
                        "id": automation_id,
                        "trigger_type": "webhook",
                        "context": if body.is_empty() { "Webhook triggered".to_string() } else { body },
                    }));
                    let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK");
                } else {
                    let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            Err(_) => {}
        }
    }
}

// ─── Trigger commands ─────────────────────────────────────────────────────────

#[tauri::command]
async fn automation_start_trigger(
    app: tauri::AppHandle,
    trigger_state: tauri::State<'_, TriggerState>,
    automation_id: String,
    trigger_type: String,
    trigger_config: String,
) -> Result<(), String> {
    // Cancel any existing trigger for this id
    if let Some(old) = trigger_state.0.lock().unwrap().remove(&automation_id) {
        old.store(false, Ordering::Relaxed);
    }
    let flag = Arc::new(AtomicBool::new(true));
    trigger_state.0.lock().unwrap().insert(automation_id.clone(), flag.clone());
    spawn_trigger(&app, automation_id, trigger_type, trigger_config, flag).await;
    Ok(())
}

#[tauri::command]
fn automation_stop_trigger(
    trigger_state: tauri::State<'_, TriggerState>,
    automation_id: String,
) -> Result<(), String> {
    if let Some(flag) = trigger_state.0.lock().unwrap().remove(&automation_id) {
        flag.store(false, Ordering::Relaxed);
    }
    Ok(())
}

// ─── Guard SQLite DB ──────────────────────────────────────────────────────────

struct GuardDbConn(Mutex<Connection>);

fn init_guard_db(app: &tauri::App) -> rusqlite::Result<Connection> {
    let dir = app.path().app_data_dir().unwrap();
    std::fs::create_dir_all(&dir).ok();
    let conn = Connection::open(dir.join("guard.db"))?;
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS guard_events (
            id          TEXT PRIMARY KEY,
            event_type  TEXT NOT NULL,
            severity    TEXT NOT NULL,
            description TEXT NOT NULL,
            metadata    TEXT,
            prev_hash   TEXT NOT NULL DEFAULT '',
            hash        TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );
    ")?;
    Ok(conn)
}

fn guard_hash(id: &str, etype: &str, desc: &str, ts: &str, prev: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    format!("{id}|{etype}|{desc}|{ts}|{prev}").hash(&mut h);
    format!("{:016x}", h.finish())
}

#[tauri::command]
fn guard_log_event(
    db: tauri::State<'_, GuardDbConn>,
    event_type: String,
    severity: String,
    description: String,
    metadata: Option<String>,
) -> Result<String, String> {
    let conn = db.0.lock().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let ts = chrono::Utc::now().to_rfc3339();
    let prev: String = conn
        .query_row("SELECT hash FROM guard_events ORDER BY created_at DESC LIMIT 1", [], |r| r.get(0))
        .unwrap_or_default();
    let hash = guard_hash(&id, &event_type, &description, &ts, &prev);
    conn.execute(
        "INSERT INTO guard_events (id,event_type,severity,description,metadata,prev_hash,hash,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![id, event_type, severity, description, metadata, prev, hash, ts],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
fn guard_get_events(
    db: tauri::State<'_, GuardDbConn>,
    limit: i64,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id,event_type,severity,description,metadata,hash,created_at
         FROM guard_events ORDER BY created_at DESC LIMIT ?1"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![limit], |row| {
        Ok(serde_json::json!({
            "id":         row.get::<_,String>(0)?,
            "event_type": row.get::<_,String>(1)?,
            "severity":   row.get::<_,String>(2)?,
            "description":row.get::<_,String>(3)?,
            "metadata":   row.get::<_,Option<String>>(4)?,
            "hash":       row.get::<_,String>(5)?,
            "created_at": row.get::<_,String>(6)?,
        }))
    }).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
fn guard_get_stats(db: tauri::State<'_, GuardDbConn>) -> Result<serde_json::Value, String> {
    let conn = db.0.lock().unwrap();
    let q = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0) };
    Ok(serde_json::json!({
        "total":             q("SELECT COUNT(*) FROM guard_events"),
        "threats":           q("SELECT COUNT(*) FROM guard_events WHERE severity IN ('high','crit')"),
        "contract_scans":    q("SELECT COUNT(*) FROM guard_events WHERE event_type='contract_scan'"),
        "phishing_detected": q("SELECT COUNT(*) FROM guard_events WHERE event_type='phishing_detected'"),
        "cve_found":         q("SELECT COUNT(*) FROM guard_events WHERE event_type='cve_found'"),
        "login_flags":       q("SELECT COUNT(*) FROM guard_events WHERE event_type='suspicious_login'"),
    }))
}

#[tauri::command]
fn guard_delete_event(
    db: tauri::State<'_, GuardDbConn>,
    id: String,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM guard_events WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn guard_clear_events(
    db: tauri::State<'_, GuardDbConn>,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM guard_events", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Automation SQLite DB ─────────────────────────────────────────────────────

struct AutomationDbConn(Mutex<Connection>);

fn init_automation_db(app: &tauri::App) -> rusqlite::Result<Connection> {
    let dir = app.path().app_data_dir().unwrap();
    std::fs::create_dir_all(&dir).ok();
    let conn = Connection::open(dir.join("automations.db"))?;
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS automations (
            id             TEXT PRIMARY KEY,
            user_id        TEXT NOT NULL,
            name           TEXT NOT NULL,
            trigger_type   TEXT NOT NULL,
            trigger_config TEXT NOT NULL DEFAULT '{}',
            steps          TEXT NOT NULL DEFAULT '[]',
            enabled        INTEGER NOT NULL DEFAULT 1,
            cloud_enabled  INTEGER NOT NULL DEFAULT 0,
            run_count      INTEGER NOT NULL DEFAULT 0,
            last_run_at    INTEGER,
            created_at     INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS automation_runs (
            id             TEXT PRIMARY KEY,
            automation_id  TEXT NOT NULL,
            user_id        TEXT NOT NULL,
            triggered_at   INTEGER NOT NULL,
            completed_at   INTEGER,
            tokens_used    INTEGER NOT NULL DEFAULT 0,
            status         TEXT NOT NULL DEFAULT 'running',
            output_summary TEXT,
            error          TEXT
        );
    ")?;
    Ok(conn)
}

#[derive(serde::Serialize, serde::Deserialize)]
struct AutomationRow {
    id: String,
    user_id: String,
    name: String,
    trigger_type: String,
    trigger_config: String,
    steps: String,
    enabled: bool,
    cloud_enabled: bool,
    run_count: i64,
    last_run_at: Option<i64>,
    created_at: i64,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct AutomationRunRow {
    id: String,
    automation_id: String,
    triggered_at: i64,
    completed_at: Option<i64>,
    tokens_used: i64,
    status: String,
    output_summary: Option<String>,
    error: Option<String>,
}

#[tauri::command]
fn automation_list(
    db: tauri::State<AutomationDbConn>,
    user_id: String,
) -> Result<Vec<AutomationRow>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id,user_id,name,trigger_type,trigger_config,steps,enabled,cloud_enabled,run_count,last_run_at,created_at
         FROM automations WHERE user_id=?1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![user_id], |row| {
        Ok(AutomationRow {
            id: row.get(0)?,
            user_id: row.get(1)?,
            name: row.get(2)?,
            trigger_type: row.get(3)?,
            trigger_config: row.get(4)?,
            steps: row.get(5)?,
            enabled: row.get::<_, i64>(6)? != 0,
            cloud_enabled: row.get::<_, i64>(7)? != 0,
            run_count: row.get(8)?,
            last_run_at: row.get(9)?,
            created_at: row.get(10)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn automation_create(
    db: tauri::State<AutomationDbConn>,
    id: String,
    user_id: String,
    name: String,
    trigger_type: String,
    trigger_config: String,
    steps: String,
) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    db.0.lock().unwrap()
        .execute(
            "INSERT INTO automations (id,user_id,name,trigger_type,trigger_config,steps,enabled,cloud_enabled,run_count,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,1,0,0,?7)",
            params![id, user_id, name, trigger_type, trigger_config, steps, now],
        )
        .map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn automation_update(
    db: tauri::State<AutomationDbConn>,
    id: String,
    name: String,
    trigger_type: String,
    trigger_config: String,
    steps: String,
) -> Result<(), String> {
    db.0.lock().unwrap()
        .execute(
            "UPDATE automations SET name=?1,trigger_type=?2,trigger_config=?3,steps=?4 WHERE id=?5",
            params![name, trigger_type, trigger_config, steps, id],
        )
        .map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn automation_toggle(
    app: tauri::AppHandle,
    db: tauri::State<'_, AutomationDbConn>,
    trigger_state: tauri::State<'_, TriggerState>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    // Get trigger info before updating
    let (trigger_type, trigger_config) = {
        let conn = db.0.lock().unwrap();
        conn.query_row(
            "SELECT trigger_type, trigger_config FROM automations WHERE id=?1",
            params![id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        ).map_err(|e| e.to_string())?
    };

    // Update DB
    db.0.lock().unwrap()
        .execute("UPDATE automations SET enabled=?1 WHERE id=?2", params![enabled as i64, id])
        .map_err(|e| e.to_string())?;

    // Start or stop the background trigger
    if enabled {
        if let Some(old) = trigger_state.0.lock().unwrap().remove(&id) {
            old.store(false, Ordering::Relaxed);
        }
        let flag = Arc::new(AtomicBool::new(true));
        trigger_state.0.lock().unwrap().insert(id.clone(), flag.clone());
        spawn_trigger(&app, id, trigger_type, trigger_config, flag).await;
    } else {
        if let Some(flag) = trigger_state.0.lock().unwrap().remove(&id) {
            flag.store(false, Ordering::Relaxed);
        }
    }

    Ok(())
}

#[tauri::command]
fn automation_cloud_toggle(
    db: tauri::State<AutomationDbConn>,
    id: String,
    cloud_enabled: bool,
) -> Result<(), String> {
    db.0.lock().unwrap()
        .execute(
            "UPDATE automations SET cloud_enabled=?1 WHERE id=?2",
            params![cloud_enabled as i64, id],
        )
        .map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn automation_delete(
    db: tauri::State<AutomationDbConn>,
    trigger_state: tauri::State<'_, TriggerState>,
    id: String,
) -> Result<(), String> {
    // Stop the running trigger first
    if let Some(flag) = trigger_state.0.lock().unwrap().remove(&id) {
        flag.store(false, Ordering::Relaxed);
    }
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM automation_runs WHERE automation_id=?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM automations WHERE id=?1", params![id])
        .map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn automation_log_run(
    db: tauri::State<AutomationDbConn>,
    run_id: String,
    automation_id: String,
    user_id: String,
    status: String,
    tokens_used: i64,
    output_summary: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO automation_runs (id,automation_id,user_id,triggered_at,completed_at,tokens_used,status,output_summary,error)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![run_id, automation_id, user_id, now, now, tokens_used, status, output_summary, error],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE automations SET run_count=run_count+1,last_run_at=?1 WHERE id=?2",
        params![now, automation_id],
    ).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn automation_get_logs(
    db: tauri::State<AutomationDbConn>,
    automation_id: Option<String>,
    limit: i64,
) -> Result<Vec<AutomationRunRow>, String> {
    let conn = db.0.lock().unwrap();
    let rows: Vec<AutomationRunRow> = if let Some(aid) = automation_id {
        let mut stmt = conn.prepare(
            "SELECT id,automation_id,triggered_at,completed_at,tokens_used,status,output_summary,error
             FROM automation_runs WHERE automation_id=?1 ORDER BY triggered_at DESC LIMIT ?2"
        ).map_err(|e| e.to_string())?;
        let result = stmt.query_map(params![aid, limit], |row| Ok(AutomationRunRow {
            id: row.get(0)?, automation_id: row.get(1)?,
            triggered_at: row.get(2)?, completed_at: row.get(3)?,
            tokens_used: row.get(4)?, status: row.get(5)?,
            output_summary: row.get(6)?, error: row.get(7)?,
        })).map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        result
    } else {
        let mut stmt = conn.prepare(
            "SELECT id,automation_id,triggered_at,completed_at,tokens_used,status,output_summary,error
             FROM automation_runs ORDER BY triggered_at DESC LIMIT ?1"
        ).map_err(|e| e.to_string())?;
        let result = stmt.query_map(params![limit], |row| Ok(AutomationRunRow {
            id: row.get(0)?, automation_id: row.get(1)?,
            triggered_at: row.get(2)?, completed_at: row.get(3)?,
            tokens_used: row.get(4)?, status: row.get(5)?,
            output_summary: row.get(6)?, error: row.get(7)?,
        })).map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        result
    };
    Ok(rows)
}

// ─── Mesh ─────────────────────────────────────────────────────────────────────

struct MeshExoProcess(Mutex<Option<std::process::Child>>);

#[derive(serde::Serialize)]
struct MeshMachineInfo {
    hostname: String,
    ram_gb:   f32,
    os:       String,
}

fn mesh_exe_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let bin = if cfg!(target_os = "windows") { "exo-node.exe" } else { "exo-node" };
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("mesh").join(bin);
        if p.exists() { return Some(p); }
    }
    if let Ok(data) = app.path().app_data_dir() {
        let p = data.join("mesh").join(bin);
        if p.exists() { return Some(p); }
    }
    None
}

#[tauri::command]
fn mesh_check_extension(app: tauri::AppHandle) -> bool {
    mesh_exe_path(&app).is_some()
}

#[tauri::command]
async fn mesh_download_extension(app: tauri::AppHandle) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let dest_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("mesh");
    tokio::fs::create_dir_all(&dest_dir).await.map_err(|e| e.to_string())?;

    let bin_name = if cfg!(target_os = "windows") { "exo-node.exe" } else { "exo-node" };
    let dest = dest_dir.join(bin_name);

    let macro_emit = {
        let app = app.clone();
        move |step: &str, pct: u32| {
            let _ = app.emit("mesh_download_progress", serde_json::json!({ "step": step, "pct": pct }));
        }
    };

    macro_emit("Fetching Mesh engine…", 5);

    // URL is hidden from frontend — only lives in compiled binary
    let url = if cfg!(target_os = "windows") {
        "https://github.com/astraluxe/nivara-desktop/releases/latest/download/exo-node.exe"
    } else if cfg!(target_arch = "aarch64") {
        "https://github.com/astraluxe/nivara-desktop/releases/latest/download/exo-node-linux-arm64"
    } else {
        "https://github.com/astraluxe/nivara-desktop/releases/latest/download/exo-node-linux-x64"
    };

    let client = reqwest::Client::builder()
        .user_agent("NivaraDesktop/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(url).send().await
        .map_err(|e| format!("Could not reach release server: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0).max(1);
    let mut downloaded: u64 = 0;
    let mut file = tokio::fs::File::create(&dest).await.map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let pct = 5 + (downloaded as f64 / total as f64 * 90.0) as u32;
        let _ = app.emit("mesh_download_progress", serde_json::json!({
            "step": format!("Downloading Mesh engine… {:.1} MB", downloaded as f64 / 1_048_576.0),
            "pct": pct.min(95),
        }));
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    // On Linux/macOS make the binary executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
    }

    macro_emit("Mesh engine installed!", 100);
    Ok(())
}

#[tauri::command]
fn mesh_get_machine_info() -> MeshMachineInfo {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_memory();
    let ram_gb = sys.total_memory() as f32 / 1_073_741_824.0;
    let hostname = std::process::Command::new("hostname")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|_| "Unknown".to_string());
    MeshMachineInfo { hostname, ram_gb, os: System::name().unwrap_or_else(|| "Windows".to_string()) }
}

#[tauri::command]
fn mesh_start_exo(
    app:        tauri::AppHandle,
    state:      tauri::State<'_, MeshExoProcess>,
    node_count: u32,
) -> Result<(), String> {
    let mut lock = state.0.lock().unwrap();
    if lock.is_some() { return Ok(()); }

    let exo_path = mesh_exe_path(&app)
        .ok_or_else(|| "Mesh engine not found. Use the download button in Mesh to install it.".to_string())?;

    let child = std::process::Command::new(&exo_path)
        .args(["--node-count", &node_count.to_string()])
        .spawn()
        .map_err(|e| format!("Failed to start mesh engine: {e}"))?;

    *lock = Some(child);
    Ok(())
}

#[tauri::command]
fn mesh_stop_exo(state: tauri::State<'_, MeshExoProcess>) -> Result<(), String> {
    let mut lock = state.0.lock().unwrap();
    if let Some(mut child) = lock.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[tauri::command]
fn mesh_exo_running(state: tauri::State<'_, MeshExoProcess>) -> bool {
    let mut lock = state.0.lock().unwrap();
    if let Some(ref mut child) = *lock {
        match child.try_wait() {
            Ok(None) => return true,
            _ => { *lock = None; }
        }
    }
    false
}

// ─── Voice-to-Code ────────────────────────────────────────────────────────────

struct VoiceState {
    recording: Arc<std::sync::atomic::AtomicBool>,
    samples:   Arc<Mutex<Vec<f32>>>,
    rate:      Arc<Mutex<u32>>,
}

impl VoiceState {
    fn new() -> Self {
        Self {
            recording: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            samples:   Arc::new(Mutex::new(Vec::new())),
            rate:      Arc::new(Mutex::new(16000)),
        }
    }
}

fn voice_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    // In the shipped installer, whisper-cli.exe and ggml-base.en.bin are bundled
    // inside the app's resource directory under voice/.
    if let Ok(res) = app.path().resource_dir() {
        let bundled = res.join("voice");
        if bundled.join("ggml-base.en.bin").exists() { return bundled; }
    }
    // Dev / manual setup fallback: downloaded via voice_download_setup command
    let dir = app.path().app_data_dir().unwrap_or_default().join("nivara-voice");
    std::fs::create_dir_all(&dir).ok();
    dir
}

#[tauri::command]
fn voice_check_setup(app: tauri::AppHandle) -> serde_json::Value {
    let dir = voice_dir(&app);
    let has_binary = find_whisper_exe(&dir).is_some();
    let has_model  = dir.join("ggml-base.en.bin").exists();
    serde_json::json!({
        "ready":      has_binary && has_model,
        "has_binary": has_binary,
        "has_model":  has_model,
    })
}

fn find_whisper_exe(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    // Windows binaries first, then Linux/macOS binaries (no extension)
    let candidates = ["whisper-cli.exe", "main.exe", "whisper.exe", "whisper-cli", "whisper-main", "main"];
    // Check dir itself
    for name in &candidates {
        let p = dir.join(name);
        if p.exists() { return Some(p); }
    }
    // Walk one level deep (for nested zip structure)
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                for name in &candidates {
                    let p = entry.path().join(name);
                    if p.exists() { return Some(p); }
                }
            }
        }
    }
    None
}

#[tauri::command]
async fn voice_download_setup(app: tauri::AppHandle) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let dir = voice_dir(&app);
    let client = reqwest::Client::builder()
        .user_agent("NivaraDesktop/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    macro_rules! progress {
        ($step:expr, $pct:expr) => {
            let _ = app.emit("voice_setup_progress", serde_json::json!({ "step": $step, "pct": $pct }));
        };
    }

    // Step 1: fetch latest release info from GitHub
    progress!("Fetching voice engine…", 5u32);
    let release: serde_json::Value = client
        .get("https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest")
        .send().await.map_err(|e| format!("Could not reach release server: {e}"))?
        .json().await.map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let asset_url = release["assets"]
        .as_array()
        .and_then(|assets| {
            assets.iter().find(|a| {
                let name = a["name"].as_str().unwrap_or("").to_lowercase();
                (name.contains("win64") || name.contains("windows") || name.contains("win-x64"))
                    && name.ends_with(".zip")
            })
        })
        .and_then(|a| a["browser_download_url"].as_str())
        .map(|s| s.to_string())
        .ok_or("No Windows binary found in latest release")?;

    #[cfg(not(target_os = "windows"))]
    let asset_url = release["assets"]
        .as_array()
        .and_then(|assets| {
            assets.iter().find(|a| {
                let name = a["name"].as_str().unwrap_or("").to_lowercase();
                (name.contains("ubuntu") || name.contains("linux") || name.contains("macos"))
                    && (name.ends_with(".tar.gz") || name.ends_with(".zip"))
            })
        })
        .and_then(|a| a["browser_download_url"].as_str())
        .map(|s| s.to_string())
        .ok_or("No Linux/macOS binary found in latest release")?;

    // Step 2: download the archive (~30 MB)
    progress!("Downloading voice engine…", 10u32);
    let is_zip = asset_url.ends_with(".zip");
    let archive_name = if is_zip { "whisper-archive.zip" } else { "whisper-archive.tar.gz" };
    let zip_path = dir.join(archive_name);
    let resp = client.get(&asset_url).send().await.map_err(|e| e.to_string())?;
    let total = resp.content_length().unwrap_or(1).max(1);
    let mut downloaded = 0u64;
    let mut file = tokio::fs::File::create(&zip_path).await.map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let pct = 10 + (downloaded as f64 / total as f64 * 50.0) as u32;
        let _ = app.emit("voice_setup_progress", serde_json::json!({
            "step": format!("Downloading voice engine… {:.1} MB", downloaded as f64 / 1_048_576.0),
            "pct": pct.min(60),
        }));
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    // Step 3: extract archive
    progress!("Installing voice engine…", 62u32);
    let extract_dir = dir.join("whisper-bin");
    let _ = std::fs::remove_dir_all(&extract_dir);

    #[cfg(target_os = "windows")]
    {
        let ps_cmd = format!(
            "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
            zip_path.display(), extract_dir.display()
        );
        let out = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd])
            .output()
            .map_err(|e| format!("Extraction failed to start: {e}"))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("Extraction error: {}", err.chars().take(200).collect::<String>()));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::fs::create_dir_all(&extract_dir);
        let out = if is_zip {
            std::process::Command::new("unzip")
                .args(["-o", &zip_path.to_string_lossy(), "-d", &extract_dir.to_string_lossy()])
                .output()
        } else {
            std::process::Command::new("tar")
                .args(["xzf", &zip_path.to_string_lossy(), "-C", &extract_dir.to_string_lossy(), "--strip-components=1"])
                .output()
        }.map_err(|e| format!("Extraction failed: {e}"))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("Extraction error: {}", err.chars().take(200).collect::<String>()));
        }
    }

    let binary = find_whisper_exe(&extract_dir)
        .ok_or("Could not find whisper executable in archive — please try again")?;
    let dest_bin_name = if cfg!(target_os = "windows") { "whisper-cli.exe" } else { "whisper-cli" };
    let dest_bin = dir.join(dest_bin_name);
    std::fs::copy(&binary, &dest_bin)
        .map_err(|e| format!("Could not install binary: {e}"))?;

    // Make executable on Linux/macOS
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dest_bin, std::fs::Permissions::from_mode(0o755));
    }

    let _ = std::fs::remove_file(&zip_path);
    let _ = std::fs::remove_dir_all(&extract_dir);

    // Step 4: download voice model (~148 MB) — shown as "Nivara voice model"
    // HuggingFace URL never exposed to the frontend
    progress!("Downloading voice model (148 MB)…", 65u32);
    let model_path = dir.join("ggml-base.en.bin");
    let model_resp = client
        .get("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin")
        .send().await
        .map_err(|e| format!("Could not download voice model: {e}"))?;
    let model_total = model_resp.content_length().unwrap_or(1).max(1);
    let mut model_downloaded = 0u64;
    let mut model_file = tokio::fs::File::create(&model_path).await.map_err(|e| e.to_string())?;
    let mut model_stream = model_resp.bytes_stream();
    while let Some(chunk) = model_stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        model_file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        model_downloaded += chunk.len() as u64;
        let pct = 65 + (model_downloaded as f64 / model_total as f64 * 30.0) as u32;
        let _ = app.emit("voice_setup_progress", serde_json::json!({
            "step": format!("Downloading voice model… {:.0} MB / 148 MB", model_downloaded as f64 / 1_048_576.0),
            "pct": pct.min(95),
        }));
    }
    model_file.flush().await.map_err(|e| e.to_string())?;

    progress!("Voice setup complete!", 100u32);
    Ok(())
}

#[tauri::command]
fn voice_is_recording(state: tauri::State<'_, VoiceState>) -> bool {
    state.recording.load(Ordering::Relaxed)
}

#[tauri::command]
fn voice_start_recording(state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    if state.recording.load(Ordering::Relaxed) {
        return Ok(());
    }
    *state.samples.lock().unwrap() = Vec::new();
    state.recording.store(true, Ordering::Relaxed);

    let recording = state.recording.clone();
    let samples   = state.samples.clone();
    let rate_out  = state.rate.clone();

    std::thread::spawn(move || {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let host   = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None    => { recording.store(false, Ordering::Relaxed); return; }
        };
        let config = match device.default_input_config() {
            Ok(c)  => c,
            Err(_) => { recording.store(false, Ordering::Relaxed); return; }
        };

        *rate_out.lock().unwrap() = config.sample_rate().0;
        let channels = config.channels() as usize;
        let sfmt     = config.sample_format();

        let err_fn = |_: cpal::StreamError| {};

        let build_stream_f32 = || {
            let rec = recording.clone();
            let buf = samples.clone();
            let ch  = channels;
            device.build_input_stream(
                &config.clone().into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if !rec.load(Ordering::Relaxed) { return; }
                    let mut lock = buf.lock().unwrap();
                    for frame in data.chunks(ch.max(1)) {
                        let s: f32 = frame.iter().copied().sum::<f32>() / ch as f32;
                        lock.push(s);
                    }
                },
                err_fn, None,
            )
        };

        let build_stream_i16 = || {
            let rec = recording.clone();
            let buf = samples.clone();
            let ch  = channels;
            device.build_input_stream(
                &config.clone().into(),
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    if !rec.load(Ordering::Relaxed) { return; }
                    let mut lock = buf.lock().unwrap();
                    for frame in data.chunks(ch.max(1)) {
                        let s: f32 = frame.iter().map(|&x| x as f32 / 32768.0).sum::<f32>() / ch as f32;
                        lock.push(s);
                    }
                },
                err_fn, None,
            )
        };

        let build_stream_u16 = || {
            let rec = recording.clone();
            let buf = samples.clone();
            let ch  = channels;
            device.build_input_stream(
                &config.clone().into(),
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    if !rec.load(Ordering::Relaxed) { return; }
                    let mut lock = buf.lock().unwrap();
                    for frame in data.chunks(ch.max(1)) {
                        let s: f32 = frame.iter().map(|&x| (x as f32 / 32768.0) - 1.0).sum::<f32>() / ch as f32;
                        lock.push(s);
                    }
                },
                err_fn, None,
            )
        };

        use cpal::SampleFormat;
        let stream_result = match sfmt {
            SampleFormat::F32 => build_stream_f32(),
            SampleFormat::I16 => build_stream_i16(),
            SampleFormat::U16 => build_stream_u16(),
            _                 => { recording.store(false, Ordering::Relaxed); return; }
        };

        match stream_result {
            Ok(stream) => {
                if stream.play().is_err() {
                    recording.store(false, Ordering::Relaxed);
                    return;
                }
                while recording.load(Ordering::Relaxed) {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                // stream drops → recording stops automatically
            }
            Err(_) => { recording.store(false, Ordering::Relaxed); }
        }
    });

    Ok(())
}

#[tauri::command]
async fn voice_stop_and_transcribe(
    app:   tauri::AppHandle,
    state: tauri::State<'_, VoiceState>,
) -> Result<String, String> {
    state.recording.store(false, Ordering::Relaxed);
    // Give the recording thread ~150 ms to drain its final callback
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let samples: Vec<f32> = state.samples.lock().unwrap().clone();
    let src_rate = *state.rate.lock().unwrap();

    if samples.is_empty() {
        return Err("No audio recorded. Check your microphone is connected.".to_string());
    }

    let dir        = voice_dir(&app);
    let bin_path   = find_whisper_exe(&dir)
        .ok_or_else(|| "Voice binary not found. Use the mic button to set up voice first.".to_string())?;
    let model_path = dir.join("ggml-base.en.bin");

    if !bin_path.exists() || !model_path.exists() {
        return Err("Voice setup not complete. Use the mic button to set up voice first.".to_string());
    }

    let wav_path = dir.join("_voice_input.wav");

    // Downsample to 16 kHz (whisper requirement) via linear interpolation
    let target = 16_000u32;
    let resampled: Vec<f32> = if src_rate == target {
        samples
    } else {
        let ratio = src_rate as f64 / target as f64;
        let n = (samples.len() as f64 / ratio) as usize;
        (0..n).map(|i| {
            let pos = i as f64 * ratio;
            let lo  = pos.floor() as usize;
            let hi  = (lo + 1).min(samples.len().saturating_sub(1));
            let t   = (pos - lo as f64) as f32;
            samples[lo] * (1.0 - t) + samples[hi] * t
        }).collect()
    };

    // Write 16 kHz mono f32 WAV
    {
        use hound::{SampleFormat as HoundFmt, WavSpec, WavWriter};
        let spec = WavSpec { channels: 1, sample_rate: 16_000, bits_per_sample: 32, sample_format: HoundFmt::Float };
        let mut writer = WavWriter::create(&wav_path, spec)
            .map_err(|e| format!("WAV write error: {e}"))?;
        for s in &resampled {
            writer.write_sample(*s).map_err(|e| format!("WAV write error: {e}"))?;
        }
        writer.finalize().map_err(|e| format!("WAV finalize error: {e}"))?;
    }

    // Run whisper-cli subprocess — stderr goes to null, stdout has the text
    let output = tokio::process::Command::new(&bin_path)
        .args([
            "-m", &model_path.to_string_lossy(),
            "-f", &wav_path.to_string_lossy(),
            "-nt",          // no timestamps
            "--no-prints",  // suppress init/timing noise (whisper.cpp ≥ 1.5)
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .await
        .map_err(|e| format!("Failed to run voice engine: {e}"))?;

    let _ = tokio::fs::remove_file(&wav_path).await;

    let text = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|l| !l.trim_start().starts_with('['))  // strip any stray [timestamps]
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();

    if text.is_empty() {
        return Err("No speech detected. Try speaking clearly and try again.".to_string());
    }

    Ok(text)
}

// ─── Vault ────────────────────────────────────────────────────────────────────

struct VaultState {
    enabled: Mutex<bool>,
    mode:    Mutex<String>,
    adapter: Mutex<Option<String>>,
}

impl VaultState {
    fn new() -> Self {
        Self {
            enabled: Mutex::new(false),
            mode:    Mutex::new("swift".to_string()),
            adapter: Mutex::new(None),
        }
    }
}

// Tray state — holds the vault toggle menu item so we can update its text without
// rebuilding the whole menu.
struct TrayState {
    vault_toggle: Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>>,
}

// ── Vault scheduled-task helpers ─────────────────────────────────────────────

fn vault_task_exists() -> bool {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("schtasks")
            .args(["/query", "/tn", "NivaraVaultDNS", "/fo", "LIST"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    { false }
}

fn write_dns_config_for_task(
    app: &tauri::AppHandle,
    enabled: bool,
    adapter: &str,
    primary: &str,
    secondary: &str,
) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).ok();
    let cfg = serde_json::json!({
        "enabled": enabled, "adapter": adapter,
        "primary": primary, "secondary": secondary,
    });
    std::fs::write(dir.join("dns_config.json"), cfg.to_string())
        .map_err(|e| e.to_string())
}

// Triggers the scheduled task and waits 900 ms for DNS to settle.
fn trigger_vault_task() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let out = std::process::Command::new("schtasks")
            .args(["/run", "/tn", "NivaraVaultDNS"])
            .output()
            .map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(900));
        if out.status.success() { Ok(()) } else {
            Err(String::from_utf8_lossy(&out.stdout).trim().to_string())
        }
    }
    #[cfg(not(target_os = "windows"))]
    { Err("Not supported on this platform.".to_string()) }
}

fn dns_for_mode(mode: &str) -> (&'static str, &'static str) {
    match mode {
        "block"  => ("94.140.14.14",   "94.140.15.15"),
        "guard"  => ("9.9.9.9",        "149.112.112.112"),
        "core"   => ("8.8.8.8",        "8.8.4.4"),
        "family" => ("208.67.222.222", "208.67.220.220"),
        _        => ("1.1.1.1",        "1.0.0.1"),  // swift (default)
    }
}

// Check if a DNS server is reachable (TCP port 53).
// Most public DNS providers accept TCP connections for DNS.
fn dns_reachable(ip: &str) -> bool {
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;
    let addr: SocketAddr = match format!("{}:53", ip).parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    TcpStream::connect_timeout(&addr, Duration::from_secs(3)).is_ok()
}

// Try all candidate adapter names in order until one succeeds.
fn apply_dns_with_fallback(adapters: &[&str], primary: &str, secondary: &str) -> Result<String, String> {
    let mut last_err = String::from("No adapters found");
    for &adapter in adapters {
        match apply_dns(adapter, primary, secondary) {
            Ok(()) => return Ok(adapter.to_string()),
            Err(e) if e == "admin_required" => return Err("admin_required".to_string()),
            Err(e) => { last_err = e; }
        }
    }
    Err(last_err)
}

// Mode preference order for auto-failover when the chosen mode's DNS is unreachable.
const MODE_FAILOVER_ORDER: &[&str] = &["swift", "core", "guard", "block", "family"];

fn get_active_adapter() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(out) = std::process::Command::new("powershell")
            .args([
                "-NoProfile", "-Command",
                "Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Sort-Object -Property Speed -Descending | Select-Object -First 1 -ExpandProperty Name",
            ])
            .output()
        {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() { return name; }
        }
        "Wi-Fi".to_string()
    }
    #[cfg(target_os = "macos")]
    { "en0".to_string() }
    #[cfg(target_os = "linux")]
    {
        // Try to find the active network interface via `ip route`
        if let Ok(out) = std::process::Command::new("ip").args(["route", "get", "1.1.1.1"]).output() {
            let s = String::from_utf8_lossy(&out.stdout);
            if let Some(dev) = s.split("dev ").nth(1).and_then(|r| r.split_whitespace().next()) {
                return dev.to_string();
            }
        }
        "eth0".to_string()
    }
}

fn apply_dns(adapter: &str, primary: &str, secondary: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let out = std::process::Command::new("netsh")
            .args(["interface", "ip", "set", "dns", adapter, "static", primary])
            .output()
            .map_err(|e| format!("Failed to run netsh: {}", e))?;

        if !out.status.success() {
            let combined = format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            let lower = combined.to_lowercase();
            if lower.contains("elevation") || lower.contains("access is denied") {
                return Err("admin_required".to_string());
            }
            return Err(combined.trim().to_string());
        }
        // Add secondary DNS
        let _ = std::process::Command::new("netsh")
            .args(["interface", "ip", "add", "dns", adapter, secondary, "index=2"])
            .output();
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        // Use resolvectl (systemd-resolved) — available on Ubuntu 20.04+, Fedora, Arch
        let out = std::process::Command::new("resolvectl")
            .args(["dns", adapter, primary, secondary])
            .output();
        match out {
            Ok(o) if o.status.success() => {
                // Also set the domain for this interface
                let _ = std::process::Command::new("resolvectl").args(["domain", adapter, "~."]).output();
                Ok(())
            }
            Ok(o) => {
                let err = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
                if err.to_lowercase().contains("permission") || err.to_lowercase().contains("access denied") {
                    Err("admin_required".to_string())
                } else {
                    Err(err.trim().to_string())
                }
            }
            Err(e) => Err(format!("resolvectl not available: {e}. Install systemd-resolved.")),
        }
    }
    #[cfg(target_os = "macos")]
    {
        let _ = (adapter, primary, secondary);
        Err("DNS switching is not supported on macOS via this method.".to_string())
    }
}

fn revert_dns(adapter: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let out = std::process::Command::new("netsh")
            .args(["interface", "ip", "set", "dns", adapter, "dhcp"])
            .output()
            .map_err(|e| format!("Failed to run netsh: {}", e))?;

        if !out.status.success() {
            let combined = format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            let lower = combined.to_lowercase();
            if lower.contains("elevation") || lower.contains("access is denied") {
                return Err("admin_required".to_string());
            }
            return Err(combined.trim().to_string());
        }
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        // Revert to DHCP DNS by telling systemd-resolved to use automatic DNS
        let out = std::process::Command::new("resolvectl")
            .args(["revert", adapter])
            .output();
        match out {
            Ok(o) if o.status.success() => Ok(()),
            Ok(o) => Err(format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr)).trim().to_string()),
            Err(e) => Err(format!("resolvectl not available: {e}")),
        }
    }
    #[cfg(target_os = "macos")]
    {
        let _ = adapter;
        Err("DNS switching is not supported on macOS.".to_string())
    }
}

fn vault_state_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|p| p.join("vault_state.json"))
}

fn save_vault_state(app: &tauri::AppHandle, enabled: bool, mode: &str, adapter: &str) {
    if let Some(path) = vault_state_path(app) {
        let json = serde_json::json!({ "enabled": enabled, "mode": mode, "adapter": adapter });
        let _ = std::fs::write(&path, json.to_string());
    }
}

fn load_vault_state(app: &tauri::AppHandle) -> Option<(bool, String, String)> {
    let path = vault_state_path(app)?;
    let text = std::fs::read_to_string(&path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let enabled = v["enabled"].as_bool().unwrap_or(false);
    let mode    = v["mode"].as_str().unwrap_or("swift").to_string();
    let adapter = v["adapter"].as_str().unwrap_or("Wi-Fi").to_string();
    Some((enabled, mode, adapter))
}

fn capitalize_first(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None    => String::new(),
        Some(f) => f.to_uppercase().to_string() + c.as_str(),
    }
}

fn update_tray_vault(app: &tauri::AppHandle, enabled: bool, mode: &str) {
    // Update toggle item text
    if let Some(ts) = app.try_state::<TrayState>() {
        if let Some(item) = ts.vault_toggle.lock().unwrap().as_ref() {
            let text = if enabled { "Disable Vault DNS" } else { "Enable Vault DNS" };
            let _ = item.set_text(text);
        }
    }
    // Update tooltip
    let Some(tray) = app.tray_by_id("main-tray") else { return };
    let tooltip = if enabled {
        format!("Vault: Protected · {} · adris.tech", capitalize_first(mode))
    } else {
        "Vault: Off · adris.tech".to_string()
    };
    let _ = tray.set_tooltip(Some(&tooltip));
}

#[derive(serde::Serialize)]
struct VaultStatusResult {
    enabled: bool,
    mode:    String,
    adapter: Option<String>,
}

#[derive(serde::Serialize)]
struct VaultEnableResult {
    adapter:       String,
    active_mode:   String,  // may differ from requested if DNS failover kicked in
    failover_used: bool,
}

// Pick the first DNS mode whose servers are actually reachable on THIS network.
// Tries the requested mode first, then the failover order. Returns None when no
// private DNS can be reached — in which case we must NOT touch the system DNS, or
// we'd strand the whole machine with no name resolution (the "internet died" bug).
fn pick_reachable_mode(requested: &str) -> Option<(String, &'static str, &'static str)> {
    let mut order: Vec<&str> = vec![requested];
    for &m in MODE_FAILOVER_ORDER { if m != requested { order.push(m); } }
    for m in order {
        let (p, s) = dns_for_mode(m);
        if dns_reachable(p) || dns_reachable(s) {
            return Some((m.to_string(), p, s));
        }
    }
    None
}

// Shared safe enable used by BOTH the UI command and the tray toggle. It never
// applies a DNS server it cannot reach, so enabling Vault can never knock the
// machine offline. If nothing is reachable it leaves DNS untouched and errors.
fn safe_vault_enable(
    app: &tauri::AppHandle,
    vault_state: &VaultState,
    requested_mode: &str,
) -> Result<VaultEnableResult, String> {
    let detected = get_active_adapter();
    let candidates = {
        let mut v = vec![detected.as_str(), "Wi-Fi", "Ethernet", "Local Area Connection", "WLAN"];
        v.dedup();
        v
    };

    // Pre-flight reachability: choose a mode we can actually reach BEFORE changing
    // anything. This is the core safety fix — we never set a dead DNS.
    let (active_mode, primary, secondary) = match pick_reachable_mode(requested_mode) {
        Some(t) => t,
        None => return Err("no_dns_reachable".to_string()),
    };
    let failover_used = active_mode != requested_mode;

    let adapter = match apply_dns_with_fallback(&candidates, primary, secondary) {
        Ok(a) => a,
        Err(e) if e == "admin_required" => {
            if vault_task_exists() {
                write_dns_config_for_task(app, true, &detected, primary, secondary)?;
                trigger_vault_task()?;
                detected.clone()
            } else {
                return Err("setup_required".to_string());
            }
        }
        Err(e) => return Err(e),
    };

    *vault_state.enabled.lock().unwrap() = true;
    *vault_state.mode.lock().unwrap()    = active_mode.clone();
    *vault_state.adapter.lock().unwrap() = Some(adapter.clone());
    save_vault_state(app, true, &active_mode, &adapter);
    update_tray_vault(app, true, &active_mode);
    Ok(VaultEnableResult { adapter, active_mode, failover_used })
}

#[tauri::command]
fn vault_enable(
    app: tauri::AppHandle,
    vault_state: tauri::State<'_, VaultState>,
    mode: String,
) -> Result<VaultEnableResult, String> {
    safe_vault_enable(&app, &vault_state, &mode)
}

#[tauri::command]
fn vault_disable(
    app: tauri::AppHandle,
    vault_state: tauri::State<'_, VaultState>,
) -> Result<(), String> {
    let (adapter, mode) = {
        let a = vault_state.adapter.lock().unwrap().clone().unwrap_or_else(get_active_adapter);
        let m = vault_state.mode.lock().unwrap().clone();
        (a, m)
    };
    match revert_dns(&adapter) {
        Ok(()) => {}
        Err(e) if e == "admin_required" => {
            if vault_task_exists() {
                write_dns_config_for_task(&app, false, &adapter, "", "")?;
                trigger_vault_task()?;
            } else {
                return Err("setup_required".to_string());
            }
        }
        Err(e) => return Err(e),
    }
    *vault_state.enabled.lock().unwrap() = false;
    save_vault_state(&app, false, &mode, &adapter);
    update_tray_vault(&app, false, &mode);
    Ok(())
}

#[tauri::command]
fn vault_status(vault_state: tauri::State<'_, VaultState>) -> VaultStatusResult {
    VaultStatusResult {
        enabled: *vault_state.enabled.lock().unwrap(),
        mode:    vault_state.mode.lock().unwrap().clone(),
        adapter: vault_state.adapter.lock().unwrap().clone(),
    }
}

#[tauri::command]
fn vault_get_adapters() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(out) = std::process::Command::new("powershell")
            .args([
                "-NoProfile", "-Command",
                "Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -ExpandProperty Name",
            ])
            .output()
        {
            let names: Vec<String> = String::from_utf8_lossy(&out.stdout)
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect();
            if !names.is_empty() { return names; }
        }
        vec!["Wi-Fi".to_string(), "Ethernet".to_string()]
    }
    #[cfg(not(target_os = "windows"))]
    { vec!["en0".to_string()] }
}

#[tauri::command]
fn vault_relaunch_elevated(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        std::process::Command::new("powershell")
            .args([
                "-NoProfile", "-Command",
                &format!("Start-Process '{}' -Verb RunAs", exe.display()),
            ])
            .spawn()
            .map_err(|e| e.to_string())?;
        app.exit(0);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Not supported on this platform.".to_string())
    }
}

// Returns true if the NivaraVaultDNS scheduled task is already installed.
#[tauri::command]
fn vault_check_setup() -> bool {
    vault_task_exists()
}

// One-time setup: creates the NivaraVaultDNS scheduled task (shows UAC once, never again).
#[tauri::command]
fn vault_do_setup(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

        let script_path = data_dir.join("vault_dns.ps1");
        let config_path = data_dir.join("dns_config.json");
        let setup_path  = data_dir.join("vault_setup_task.ps1");

        // The DNS-switching helper (runs as SYSTEM via the scheduled task)
        let cfg = config_path.to_string_lossy().replace('\\', "\\\\");
        let dns_script = format!(
            r#"$cfg = Get-Content '{cfg}' -Raw | ConvertFrom-Json
if ($cfg.enabled -eq $true) {{
    netsh interface ip set dns "$($cfg.adapter)" static $cfg.primary | Out-Null
    netsh interface ip add dns "$($cfg.adapter)" $cfg.secondary index=2 | Out-Null
}} else {{
    netsh interface ip set dns "$($cfg.adapter)" dhcp | Out-Null
}}"#
        );
        std::fs::write(&script_path, dns_script).map_err(|e| e.to_string())?;

        // The one-time setup script — runs elevated, creates task + grants Users run rights
        let sp = script_path.to_string_lossy().replace('\\', "\\\\");
        let setup_script = format!(
            r#"$action   = New-ScheduledTaskAction -Execute 'powershell.exe' `
             -Argument ('-NonInteractive -ExecutionPolicy Bypass -File "{sp}"')
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
             -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'NivaraVaultDNS' `
    -Action $action -Principal $principal -Settings $settings -Force | Out-Null
$svc = New-Object -ComObject Schedule.Service
$svc.Connect()
$t  = $svc.GetFolder('\').GetTask('NivaraVaultDNS')
$sd = $t.GetSecurityDescriptor(4)
if ($sd -notmatch 'BU') {{ $t.SetSecurityDescriptor($sd + '(A;;GRGX;;;BU)', 0) }}"#
        );
        std::fs::write(&setup_path, setup_script).map_err(|e| e.to_string())?;

        // Launch setup script elevated — UAC prompt fires exactly once, ever
        let sp2 = setup_path.to_string_lossy().replace('\\', "\\\\");
        std::process::Command::new("powershell")
            .args([
                "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                "-Command",
                &format!(
                    "Start-Process powershell.exe \
                     -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','\"{sp2}\"') \
                     -Verb RunAs -Wait"
                ),
            ])
            .output()
            .map_err(|e| e.to_string())?;

        std::thread::sleep(std::time::Duration::from_millis(800));
        if vault_task_exists() {
            Ok(())
        } else {
            Err("Setup was cancelled — the Windows permission prompt was denied.".to_string())
        }
    }
    #[cfg(not(target_os = "windows"))]
    { Err("Vault DNS setup is only available on Windows.".to_string()) }
}

// ─── Auto-update ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn test_krew_connection() -> String {
    let health  = "https://xkkqcqsacgdrfwbwdqsp.supabase.co/health";
    let krew    = "https://xkkqcqsacgdrfwbwdqsp.supabase.co/functions/v1/krew-stream";
    let payload = serde_json::json!({"messages":[],"systemPrompt":""});
    let mut out = String::new();

    // Test 1 — plain HTTPS GET (default client)
    match reqwest::Client::new().get(health).timeout(std::time::Duration::from_secs(8)).send().await {
        Ok(r)  => out.push_str(&format!("1. Health GET: {} {}\n", r.status().as_u16(), r.status().canonical_reason().unwrap_or(""))),
        Err(e) => out.push_str(&format!("1. Health GET FAILED: {}\n", e)),
    }

    // Test 2 — POST to krew-stream (default HTTP/2 client, no auth — expect 401)
    match reqwest::Client::new().post(krew)
        .header("Content-Type","application/json").json(&payload)
        .timeout(std::time::Duration::from_secs(10)).send().await {
        Ok(r)  => { let s = r.status(); let b = r.text().await.unwrap_or_default();
                    out.push_str(&format!("2. krew POST (h2): {} — {}\n", s.as_u16(), b.chars().take(120).collect::<String>())); }
        Err(e) => out.push_str(&format!("2. krew POST (h2) FAILED: {}\n", e)),
    }

    // Test 3 — POST to krew-stream (HTTP/1.1 forced, no auth — expect 401)
    let c1 = reqwest::Client::builder().http1_only().timeout(std::time::Duration::from_secs(10)).build().unwrap_or_else(|_| reqwest::Client::new());
    match c1.post(krew).header("Content-Type","application/json").json(&payload).send().await {
        Ok(r)  => { let s = r.status(); let b = r.text().await.unwrap_or_default();
                    out.push_str(&format!("3. krew POST (h1): {} — {}\n", s.as_u16(), b.chars().take(120).collect::<String>())); }
        Err(e) => out.push_str(&format!("3. krew POST (h1) FAILED: {}\n", e)),
    }

    out
}

// Parse "1.2.3" (tolerating a leading 'v' and extra build metadata) into (major, minor, patch).
fn parse_semver(v: &str) -> (u64, u64, u64) {
    let v = v.trim().trim_start_matches('v');
    let core = v.split(|c| c == '-' || c == '+').next().unwrap_or(v);
    let mut it = core.split('.').map(|p| p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse::<u64>().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

// Ask the GitHub API directly for the newest release tag. This is a FALLBACK for the Tauri
// updater's static endpoint: right after a release is published, GitHub's CDN-cached
// `/releases/latest/download/latest.json` redirect can briefly still point at the PREVIOUS
// release, so the updater reports "you're on the latest" for a minute or two. The API's
// "latest release" flips reliably, so we use it to avoid that false negative.
async fn github_latest_version() -> Option<String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/repos/astraluxe/nivara-desktop/releases/latest")
        .header("User-Agent", "NivaraDesktop")
        .header("Accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(12))
        .send().await.ok()?;
    if !resp.status().is_success() { return None; }
    let json: serde_json::Value = resp.json().await.ok()?;
    json.get("tag_name").and_then(|t| t.as_str()).map(|s| s.to_string())
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri_plugin_updater::UpdaterExt;
    let current = app.package_info().version.to_string();
    // 1) Primary — the signature-verified Tauri updater.
    match app.updater().map_err(|e| e.to_string())?.check().await {
        Ok(Some(update)) => return Ok(serde_json::json!({
            "available": true,
            "version": update.version,
            "body": update.body.unwrap_or_default(),
            "current": current,
        })),
        Ok(None) => { /* fall through to the API fallback before concluding "latest" */ }
        Err(e) => return Err(e.to_string()),
    }
    // 2) Fallback — the Tauri endpoint said "none". Double-check via the GitHub API so a
    // still-propagating release isn't mistaken for "you're already up to date".
    if let Some(tag) = github_latest_version().await {
        if parse_semver(&tag) > parse_semver(&current) {
            return Ok(serde_json::json!({
                "available": true,
                "version": tag.trim_start_matches('v'),
                "body": "A new version is available.",
                "current": current,
                // The download is published but GitHub is still updating its \"latest\" pointer,
                // so the in-app installer may need another minute. The UI can offer a direct link.
                "propagating": true,
            }));
        }
    }
    Ok(serde_json::json!({ "available": false, "current": current }))
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    use tauri::Manager;
    let updater = app.updater().map_err(|e| e.to_string())?;
    // Retry the check a few times: right after a release is published the updater endpoint can
    // briefly 404 / still resolve to the old release while GitHub propagates. Without this, the
    // installer silently did nothing and the UI hung on "installing…". A short retry rides out
    // the propagation window; if it still isn't ready we return a clear error the UI can show.
    let mut found = None;
    for attempt in 0..4 {
        match updater.check().await {
            Ok(Some(u)) => { found = Some(u); break; }
            Ok(None) => { if attempt < 3 { tokio::time::sleep(std::time::Duration::from_secs(3)).await; } }
            Err(e) => return Err(e.to_string()),
        }
    }
    let update = match found {
        Some(u) => u,
        None => return Err("The update is published but GitHub is still making it available. Please try again in a minute, or download it from github.com/astraluxe/nivara-desktop/releases/latest.".to_string()),
    };
    {
        // Stream download progress to the UI — a silent multi-MB download looked like
        // "clicked download, nothing happened" (the exact user complaint on v0.69).
        let progress_app = app.clone();
        let mut downloaded: u64 = 0;
        update
            .download_and_install(
                move |chunk, total| {
                    downloaded += chunk as u64;
                    let _ = progress_app.emit(
                        "update-progress",
                        serde_json::json!({ "downloaded": downloaded, "total": total }),
                    );
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;
        // Drop a sentinel so the relaunched app FORCES the main window open — the update relaunch
        // can inherit the autostart "--quickbar" arg (which normally keeps main hidden), so after
        // an update the user only saw the Quick Bar, not the app window. setup() consumes this.
        if let Ok(dir) = app.path().app_data_dir() {
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(dir.join(".show-main-after-update"), b"1");
        }
        // REQUIRED on Windows: download_and_install runs the installer but does NOT relaunch —
        // without this the app sat forever on "downloading… will restart" (the installer was
        // waiting for the app to exit). restart() exits so the install finishes, then relaunches
        // onto the new version. This diverges (never returns).
        app.restart();
    }
    Ok(())
}

// ─── Entry point ─────────────────────────────────────────────────────────────

pub fn run() {
    let pty_map: PtyMap = pty_map_state();

    tauri::Builder::default()
        // MUST be the first plugin. Without it, opening the exe while the
        // autostarted (--quickbar) instance is already running spawns a SECOND
        // full process — two tray icons, two bars, two badges. Instead, the
        // second launch just surfaces the existing instance's main window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.unminimize();
                let _ = main.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Autostart at login with --quickbar: the Quick Bar appears without the user
        // "opening the exe" — the main window stays hidden until they ask for it.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--quickbar"]),
        ))
        .manage(pty_map)
        .setup(|app| {
            // If we just relaunched after an update, FORCE the main window open (even if this
            // launch inherited the autostart "--quickbar" flag). Otherwise the user only saw the
            // Quick Bar after updating, not the app. The sentinel is written by install_update.
            let show_after_update = app.path().app_data_dir().ok()
                .map(|d| d.join(".show-main-after-update"))
                .filter(|p| p.exists())
                .map(|p| { let _ = std::fs::remove_file(&p); true })
                .unwrap_or(false);
            // Launched by autostart (--quickbar): keep the MAIN window hidden — the
            // always-on-top Quick Bar is the only thing the user sees. Opening the app
            // normally (no flag) shows the main window as always.
            if std::env::args().any(|a| a == "--quickbar") && !show_after_update {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.hide();
                }
            } else if show_after_update {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.unminimize();
                    let _ = main.set_focus();
                }
            }
            let conn      = init_db(app).expect("Failed to open Coder SQLite DB");
            let krew_conn = init_krew_db(app).expect("Failed to open Krew SQLite DB");
            let auto_conn  = init_automation_db(app).expect("Failed to open Automation SQLite DB");
            let guard_conn = init_guard_db(app).expect("Failed to open Guard SQLite DB");
            app.manage(DbConn(Mutex::new(conn)));
            app.manage(KrewDbConn(Mutex::new(krew_conn)));
            app.manage(AutomationDbConn(Mutex::new(auto_conn)));
            app.manage(GuardDbConn(Mutex::new(guard_conn)));
            app.manage(TriggerState(Mutex::new(HashMap::new())));
            app.manage(VaultState::new());
            app.manage(MeshExoProcess(Mutex::new(None)));
            app.manage(LlamaEngineProcess(Mutex::new(None)));
            app.manage(VoiceState::new());
            app.manage(SessionKeyState::new());
            setup_tray(app)?;

            // Corner badge — authoritative Rust-side driver. The two JS paths (the
            // badge's own script and the main window's driveBadge) have proven fragile
            // on real machines; Rust positions and shows the window directly with no
            // webview timing or capability/ACL dependencies. The badge's own script
            // stays the owner of the off/snooze state (localStorage) and hides the
            // window right back within seconds if the user disabled it.
            let badge_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                for delay in [2u64, 8, 20] {
                    tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
                    if let Some(badge) = badge_handle.get_webview_window("quickbadge") {
                        if let Ok(Some(mon)) = badge.primary_monitor() {
                            let sf = mon.scale_factor();
                            let pos = mon.position();
                            let size = mon.size();
                            let x = pos.x + size.width as i32 - (56.0 * sf) as i32 - (10.0 * sf) as i32;
                            let y = pos.y + (size.height as f64 * 0.32) as i32;
                            let _ = badge.set_position(tauri::PhysicalPosition::new(x, y));
                        }
                        let _ = badge.show();
                        let _ = badge.set_always_on_top(true);
                    }
                }
            });

            // Start background triggers for all currently-enabled automations
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Small delay to let app fully initialise
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;

                let enabled: Vec<(String, String, String)> = {
                    let auto_db = app_handle.state::<AutomationDbConn>();
                    let conn = auto_db.0.lock().unwrap();
                    let mut stmt = match conn.prepare(
                        "SELECT id, trigger_type, trigger_config FROM automations WHERE enabled=1"
                    ) {
                        Ok(s) => s,
                        Err(_) => return,
                    };
                    stmt.query_map([], |row| Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    )))
                    .unwrap()
                    .flatten()
                    .collect()
                };

                let trigger_state = app_handle.state::<TriggerState>();
                for (id, trigger_type, trigger_config) in enabled {
                    let flag = Arc::new(AtomicBool::new(true));
                    trigger_state.0.lock().unwrap().insert(id.clone(), flag.clone());
                    spawn_trigger(&app_handle, id, trigger_type, trigger_config, flag).await;
                }
            });

            // Restore vault DNS protection if it was active before the app closed
            let vault_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                if let Some((was_enabled, mode, saved_adapter)) = load_vault_state(&vault_app) {
                    let vs = vault_app.state::<VaultState>();
                    *vs.mode.lock().unwrap() = mode.clone();
                    if was_enabled {
                        // Try saved adapter first, then detected, then common fallbacks
                        let detected = get_active_adapter();
                        let candidates = {
                            let mut v = vec![
                                saved_adapter.as_str(), detected.as_str(),
                                "Wi-Fi", "Ethernet", "Local Area Connection",
                            ];
                            v.dedup();
                            v
                        };
                        // Safety: only re-apply a DNS we can actually reach on THIS network.
                        // If the user moved to a network that blocks the saved DNS, stay on DHCP
                        // (working internet) instead of stranding the machine offline.
                        match pick_reachable_mode(&mode) {
                            Some((active_mode, primary, secondary)) => {
                                match apply_dns_with_fallback(&candidates, primary, secondary) {
                                    Ok(adapter) => {
                                        *vs.enabled.lock().unwrap() = true;
                                        *vs.mode.lock().unwrap()    = active_mode.clone();
                                        *vs.adapter.lock().unwrap() = Some(adapter.clone());
                                        save_vault_state(&vault_app, true, &active_mode, &adapter);
                                        update_tray_vault(&vault_app, true, &active_mode);
                                    }
                                    Err(e) if e == "admin_required" => {
                                        if vault_task_exists()
                                            && write_dns_config_for_task(&vault_app, true, &saved_adapter, primary, secondary).is_ok()
                                            && trigger_vault_task().is_ok()
                                        {
                                            *vs.enabled.lock().unwrap() = true;
                                            *vs.mode.lock().unwrap()    = active_mode.clone();
                                            *vs.adapter.lock().unwrap() = Some(saved_adapter.clone());
                                            save_vault_state(&vault_app, true, &active_mode, &saved_adapter);
                                            update_tray_vault(&vault_app, true, &active_mode);
                                        } else if !vault_task_exists() {
                                            let _ = vault_app.emit("vault_needs_admin", serde_json::json!({ "mode": active_mode }));
                                        }
                                    }
                                    Err(_) => {} // adapter gone or netsh error — vault stays off
                                }
                            }
                            None => {
                                // No private DNS reachable here — ensure DHCP (working resolution)
                                // and leave Vault OFF so the user is never stranded.
                                let _ = revert_dns(&detected);
                                *vs.enabled.lock().unwrap() = false;
                                save_vault_state(&vault_app, false, &mode, &detected);
                                update_tray_vault(&vault_app, false, &mode);
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // OAuth — Supabase
            start_oauth_server,
            poll_oauth_code,
            // OAuth — Google
            start_google_oauth_server,
            poll_google_auth_code,
            google_exchange_code,
            google_refresh_token,
            // OAuth — LinkedIn
            start_linkedin_oauth_server,
            poll_linkedin_auth_code,
            linkedin_exchange_code,
            // OAuth — Notion
            start_notion_oauth_server,
            poll_notion_auth_code,
            notion_exchange_code,
            // PTY
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            // File system
            list_dir,
            read_file,
            write_file,
            open_folder_dialog,
            scan_folder_for_compliance,
            // AI — Coder
            ai_stream,
            // AI — Krew (with system prompt support)
            krew_ai_stream,
            // Coder chat DB
            db_new_session,
            db_save_message,
            db_get_sessions,
            db_get_messages,
            db_delete_session,
            db_delete_all,
            db_get_recent_sessions,
            // Krew chat DB
            db_krew_new_session,
            db_krew_get_sessions,
            db_krew_update_title,
            db_krew_save_message,
            db_krew_get_messages,
            db_krew_delete_session,
            db_krew_save_summary,
            db_krew_get_summary,
            // Krew memory
            db_krew_save_memory,
            db_krew_get_memories,
            db_krew_delete_memory,
            // Credential store
            store_credential,
            get_credential,
            delete_credential,
            list_credentials,
            // Token tracking
            track_token_usage,
            get_token_usage_this_month,
            fetch_session_key,
            krew_generate_image,
            fetch_stock_image,
            save_deck_files,
            read_deck_spec,
            open_path,
            sync_token_usage_direct,
            // Krew tools
            ping_service,
            reddit_post,
            krew_web_search,
            krew_execute_command,
            setup_agent_browser,
            run_agent_browser,
            run_agent_browser_session,
            run_browser_persistent,
            open_in_system_browser,
            fetch_page_text,
            read_browser_history,
            krew_http_call,
            mcp_http_call,
            gmail_fetch_emails,
            gmail_fetch_email_body,
            // Automation
            automation_list,
            automation_create,
            automation_update,
            automation_toggle,
            automation_cloud_toggle,
            automation_delete,
            automation_log_run,
            automation_get_logs,
            automation_start_trigger,
            automation_stop_trigger,
            // System
            get_system_info,
            // Models
            detect_gpu,
            models_list_installed,
            models_download,
            models_delete,
            models_check_engine_installed,
            models_check_engine,
            models_run,
            models_stop_engine,
            models_download_engine,
            models_pick_file,
            brain_pick_file,
            brain_extract_text,
            read_file_base64,
            brain_store_file,
            brain_store_image,
            save_to_downloads,
            file_size,
            models_import,
            studio_save_file,
            // Vault
            vault_enable,
            vault_disable,
            vault_status,
            vault_get_adapters,
            vault_relaunch_elevated,
            vault_check_setup,
            vault_do_setup,
            // Mesh
            mesh_check_extension,
            mesh_download_extension,
            mesh_get_machine_info,
            mesh_start_exo,
            mesh_stop_exo,
            mesh_exo_running,
            // Voice-to-Code
            voice_check_setup,
            voice_download_setup,
            voice_is_recording,
            voice_start_recording,
            voice_stop_and_transcribe,
            // Guard
            guard_log_event,
            guard_get_events,
            guard_get_stats,
            guard_delete_event,
            guard_clear_events,
            // Updater
            test_krew_connection,
            check_for_update,
            install_update,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("Nivara failed to start");
}
