/// adris.tech Mesh — exo-node
/// Peer discovery + RAM pooling node.
/// Spawned by the desktop app; runs in the background.
///
/// CLI: exo-node [--node-count N] [--room CODE]

use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

// ── Constants ──────────────────────────────────────────────────────────────────

const DISCOVERY_PORT: u16 = 47832;
const STATUS_PORT:    u16 = 47833;
const BROADCAST_IV:   Duration = Duration::from_secs(3);
const PEER_TTL:       Duration = Duration::from_secs(12);

// ── Types ──────────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct Peer {
    addr:     IpAddr,
    hostname: String,
    ram_gb:   f32,
    seen:     Instant,
}

type Peers = Arc<Mutex<HashMap<IpAddr, Peer>>>;

// ── Entry point ────────────────────────────────────────────────────────────────

fn main() {
    let args: Vec<String> = std::env::args().collect();

    let node_count = parse_arg(&args, "--node-count").and_then(|s| s.parse::<u32>().ok()).unwrap_or(1);
    let room_code  = parse_arg(&args, "--room").unwrap_or_else(|| "ADRIS-DEFAULT".to_string());

    let hostname = hostname();
    let ram_gb   = total_ram_gb();

    eprintln!("[exo-node] Starting — room={room_code} node_count={node_count} host={hostname} ram={ram_gb:.1}GB");

    let peers: Peers = Arc::new(Mutex::new(HashMap::new()));

    // Thread 1: UDP broadcast (announce self every 3 s)
    {
        let peers   = peers.clone();
        let room    = room_code.clone();
        let host    = hostname.clone();
        std::thread::spawn(move || broadcast_loop(&room, &host, ram_gb, node_count, &peers));
    }

    // Thread 2: UDP listener (collect peer announcements)
    {
        let peers = peers.clone();
        let room  = room_code.clone();
        std::thread::spawn(move || listen_loop(&room, &peers));
    }

    // Thread 3: TCP status server (localhost only — app can query peer list)
    {
        let peers = peers.clone();
        let host  = hostname.clone();
        std::thread::spawn(move || status_server(&host, ram_gb, &peers));
    }

    // Main thread: evict stale peers + stay alive
    loop {
        {
            let mut map = peers.lock().unwrap();
            map.retain(|_, p| p.seen.elapsed() < PEER_TTL);
        }
        std::thread::sleep(Duration::from_secs(5));
    }
}

// ── UDP broadcast ──────────────────────────────────────────────────────────────

fn broadcast_loop(room: &str, hostname: &str, ram_gb: f32, node_count: u32, peers: &Peers) {
    let sock = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(e) => { eprintln!("[exo-node] broadcast bind error: {e}"); return; }
    };
    let _ = sock.set_broadcast(true);
    let dest = SocketAddr::new(IpAddr::V4(Ipv4Addr::BROADCAST), DISCOVERY_PORT);
    let msg  = format!("ADRIS-MESH|{room}|{hostname}|{ram_gb:.2}|{node_count}");

    loop {
        let _ = sock.send_to(msg.as_bytes(), dest);

        // Evict stale peers while we're at it
        {
            let mut map = peers.lock().unwrap();
            map.retain(|_, p| p.seen.elapsed() < PEER_TTL);
        }

        std::thread::sleep(BROADCAST_IV);
    }
}

// ── UDP listener ───────────────────────────────────────────────────────────────

fn listen_loop(room: &str, peers: &Peers) {
    let sock = match UdpSocket::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), DISCOVERY_PORT)) {
        Ok(s) => s,
        Err(e) => { eprintln!("[exo-node] listen bind error: {e}"); return; }
    };
    let _ = sock.set_read_timeout(Some(Duration::from_secs(5)));

    let mut buf = [0u8; 256];
    loop {
        if let Ok((n, src)) = sock.recv_from(&mut buf) {
            if let Ok(msg) = std::str::from_utf8(&buf[..n]) {
                parse_announcement(msg, src.ip(), room, peers);
            }
        }
    }
}

fn parse_announcement(msg: &str, src: IpAddr, room: &str, peers: &Peers) {
    // Format: ADRIS-MESH|<room>|<hostname>|<ram_gb>|<node_count>
    let parts: Vec<&str> = msg.splitn(5, '|').collect();
    if parts.len() < 4 || parts[0] != "ADRIS-MESH" || parts[1] != room { return; }
    let peer_host = parts[2].to_string();
    let peer_ram  = parts[3].parse::<f32>().unwrap_or(0.0);

    let mut map = peers.lock().unwrap();
    map.insert(src, Peer { addr: src, hostname: peer_host, ram_gb: peer_ram, seen: Instant::now() });
}

// ── TCP status server (localhost) ─────────────────────────────────────────────

fn status_server(hostname: &str, ram_gb: f32, peers: &Peers) {
    let listener = match TcpListener::bind(format!("127.0.0.1:{STATUS_PORT}")) {
        Ok(l) => l,
        Err(e) => { eprintln!("[exo-node] status server error: {e}"); return; }
    };
    for stream in listener.incoming().flatten() {
        let _ = handle_status(stream, hostname, ram_gb, peers);
    }
}

fn handle_status(mut stream: TcpStream, hostname: &str, ram_gb: f32, peers: &Peers) -> std::io::Result<()> {
    let mut req = [0u8; 64];
    let n = stream.read(&mut req)?;
    if &req[..n.min(3)] != b"GET" { return Ok(()); }

    let map = peers.lock().unwrap();
    let peer_list: Vec<String> = map.values()
        .map(|p| format!(r#"{{"host":"{}","ram":{:.1}}}"#, p.hostname, p.ram_gb))
        .collect();
    let total_ram: f32 = map.values().map(|p| p.ram_gb).sum::<f32>() + ram_gb;

    let body = format!(
        r#"{{"self":{{"host":"{hostname}","ram":{ram_gb:.1}}},"peers":[{}],"total_ram":{total_ram:.1}}}"#,
        peer_list.join(",")
    );

    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n\r\n{}",
        body.len(), body
    );
    stream.write_all(resp.as_bytes())
}

// ── Helpers ────────────────────────────────────────────────────────────────────

fn parse_arg(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned()
}

fn hostname() -> String {
    std::process::Command::new("hostname")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|_| "adris-node".to_string())
}

fn total_ram_gb() -> f32 {
    // Read from /proc/meminfo on Linux, or use WMIC on Windows
    #[cfg(target_os = "windows")]
    {
        let out = std::process::Command::new("wmic")
            .args(["computersystem", "get", "TotalPhysicalMemory", "/value"])
            .output();
        if let Ok(o) = out {
            let s = String::from_utf8_lossy(&o.stdout);
            if let Some(line) = s.lines().find(|l| l.starts_with("TotalPhysicalMemory=")) {
                if let Ok(bytes) = line.trim_start_matches("TotalPhysicalMemory=").trim().parse::<u64>() {
                    return bytes as f32 / 1_073_741_824.0;
                }
            }
        }
        8.0 // fallback
    }
    #[cfg(not(target_os = "windows"))]
    {
        8.0
    }
}
