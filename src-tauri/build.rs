fn main() {
    ensure_icons(); // must run before tauri_build so icon.ico exists for the Windows resource

    #[cfg(target_os = "windows")]
    {
        tauri_build::try_build(
            tauri_build::Attributes::new().windows_attributes(
                tauri_build::WindowsAttributes::new()
                    .app_manifest(include_str!("app.manifest")),
            ),
        )
        .expect("error while running tauri-build!");
    }

    #[cfg(not(target_os = "windows"))]
    tauri_build::build();
}

// Generates solid-purple placeholder PNGs if the icons directory is empty.
// Real icons can be generated later with: npx tauri icon <source.png>
fn ensure_icons() {
    use std::{fs, path::Path};

    let icons_dir = Path::new("icons");

    let png_needed: &[(&str, u32)] = &[
        ("32x32.png", 32),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
    ];

    let all_exist = png_needed.iter().all(|(name, _)| icons_dir.join(name).exists())
        && icons_dir.join("icon.ico").exists();
    if all_exist {
        println!("cargo:rerun-if-changed=icons/32x32.png");
        return;
    }

    fs::create_dir_all(icons_dir).expect("create icons dir");
    for (name, size) in png_needed {
        let path = icons_dir.join(name);
        if !path.exists() {
            fs::write(&path, make_purple_png(*size)).expect("write icon");
            println!("cargo:warning=Generated placeholder icon: {}", name);
        }
    }

    // icon.ico — minimal ICO wrapping the 32x32 PNG (Windows Vista+ supports PNG-in-ICO)
    let ico_path = icons_dir.join("icon.ico");
    if !ico_path.exists() {
        let png_bytes = make_purple_png(32);
        let ico = make_ico_from_png(&png_bytes);
        fs::write(&ico_path, ico).expect("write icon.ico");
        println!("cargo:warning=Generated placeholder icon.ico");
    }

    println!("cargo:rerun-if-changed=icons/");
}

// Pure-Rust PNG encoder — solid #7C5CFF (Nivara accent purple).
// Uses uncompressed (stored) DEFLATE blocks wrapped in zlib. No external crates needed.
fn make_purple_png(size: u32) -> Vec<u8> {
    // Raw scanlines: filter_byte(0) + width * [R, G, B]
    let row_len = 1 + size as usize * 3;
    let mut raw = vec![0u8; size as usize * row_len];
    for y in 0..size as usize {
        let base = y * row_len;
        raw[base] = 0; // filter: None
        for x in 0..size as usize {
            let p = base + 1 + x * 3;
            raw[p]     = 0x7C; // R
            raw[p + 1] = 0x5C; // G
            raw[p + 2] = 0xFF; // B
        }
    }

    let mut out = vec![137u8, 80, 78, 71, 13, 10, 26, 10]; // PNG signature

    // IHDR
    let mut ihdr = [0u8; 13];
    ihdr[0..4].copy_from_slice(&size.to_be_bytes());
    ihdr[4..8].copy_from_slice(&size.to_be_bytes());
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // RGB color type
    png_chunk(&mut out, b"IHDR", &ihdr);

    // IDAT — raw data wrapped in zlib (stored DEFLATE)
    let compressed = zlib_encode(&raw);
    png_chunk(&mut out, b"IDAT", &compressed);

    png_chunk(&mut out, b"IEND", &[]);
    out
}

fn png_chunk(out: &mut Vec<u8>, tag: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(tag);
    out.extend_from_slice(data);
    let mut crc_buf: Vec<u8> = Vec::with_capacity(4 + data.len());
    crc_buf.extend_from_slice(tag);
    crc_buf.extend_from_slice(data);
    out.extend_from_slice(&crc32(&crc_buf).to_be_bytes());
}

fn zlib_encode(data: &[u8]) -> Vec<u8> {
    // CMF=0x78 (deflate, window=32768), FLG=0x01 → 0x7801 % 31 == 0 ✓
    let deflated = deflate_stored(data);
    let check    = adler32(data).to_be_bytes();
    let mut out  = Vec::with_capacity(2 + deflated.len() + 4);
    out.push(0x78);
    out.push(0x01);
    out.extend_from_slice(&deflated);
    out.extend_from_slice(&check);
    out
}

// Uncompressed DEFLATE (type 0 stored blocks, max 65535 bytes each).
fn deflate_stored(data: &[u8]) -> Vec<u8> {
    const MAX: usize = 65535;
    let mut out = Vec::new();
    let mut pos = 0;
    let len = data.len();
    loop {
        let end     = (pos + MAX).min(len);
        let is_last = end == len;
        let chunk   = &data[pos..end];
        let n       = chunk.len() as u16;
        out.push(if is_last { 0x01 } else { 0x00 });
        out.extend_from_slice(&n.to_le_bytes());
        out.extend_from_slice(&(!n).to_le_bytes());
        out.extend_from_slice(chunk);
        pos = end;
        if is_last { break; }
    }
    out
}

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &byte in data {
        a = a.wrapping_add(byte as u32) % 65521;
        b = b.wrapping_add(a) % 65521;
    }
    (b << 16) | a
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xedb88320 } else { crc >> 1 };
        }
    }
    !crc
}

// Wraps PNG bytes in a minimal ICO container (PNG-in-ICO, Win Vista+).
fn make_ico_from_png(png: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    // ICO header: reserved(2) type=1(2) count=1(2)
    out.extend_from_slice(&[0u8, 0, 1, 0, 1, 0]);
    // Directory entry (16 bytes): w h cc reserved planes bitcount size(4LE) offset(4LE)
    let size = png.len() as u32;
    let offset: u32 = 6 + 16; // header + one entry
    out.push(32); // width
    out.push(32); // height
    out.push(0);  // color count (0 = >256 colors)
    out.push(0);  // reserved
    out.extend_from_slice(&1u16.to_le_bytes()); // planes
    out.extend_from_slice(&32u16.to_le_bytes()); // bit count
    out.extend_from_slice(&size.to_le_bytes());
    out.extend_from_slice(&offset.to_le_bytes());
    out.extend_from_slice(png);
    out
}
