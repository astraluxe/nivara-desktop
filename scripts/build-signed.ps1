# Build a signed release for auto-update support.
# Usage (from nivara-desktop folder):
#   .\scripts\build-signed.ps1

Set-Location "$PSScriptRoot\.."

$keyFile = ".tauri\nivara.key"
if (-not (Test-Path $keyFile)) {
    Write-Host "ERROR: .tauri\nivara.key not found." -ForegroundColor Red
    exit 1
}

# Set signing env vars in the CURRENT session so npm/cargo child processes inherit them.
$env:TAURI_SIGNING_PRIVATE_KEY          = (Get-Content $keyFile -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""

$version = (Get-Content "src-tauri/tauri.conf.json" | ConvertFrom-Json).version
Write-Host "Building v$version..." -ForegroundColor Cyan
npm run tauri build
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed." -ForegroundColor Red; exit 1 }

# Paths
$bundle = "src-tauri\target\release\bundle\nsis"
$exe    = "$bundle\adris.tech_${version}_x64-setup.exe"
$sig    = "$bundle\adris.tech_${version}_x64-setup.exe.sig"

if (-not (Test-Path $sig)) {
    Write-Host "WARNING: Tauri auto-sign did not produce .sig - attempting manual sign..." -ForegroundColor Yellow
    & npx tauri signer sign --private-key-path $keyFile --password "" $exe
    if (-not (Test-Path $sig)) {
        Write-Host "ERROR: Signing failed. .sig not produced." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Signed OK" -ForegroundColor Green

# Generate latest.json
$sigText = (Get-Content $sig -Raw).Trim()
$latest = [ordered]@{
    version  = $version
    notes    = "Bug fixes and improvements"
    pub_date = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $sigText
            url = "https://github.com/astraluxe/nivara-desktop/releases/download/v${version}/adris.tech_${version}_x64-setup.exe"
        }
    }
}
$json = $latest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path (Get-Location).Path "latest.json"), $json, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Generated latest.json" -ForegroundColor Green

# Create release if needed, then upload
$gh  = "C:\Program Files\GitHub CLI\gh.exe"
$tag = "v$version"

& $gh release view $tag --repo astraluxe/nivara-desktop 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating GitHub release $tag..." -ForegroundColor Cyan
    & $gh release create $tag --repo astraluxe/nivara-desktop --title $tag --notes "Bug fixes and improvements" --latest
}

Write-Host "Uploading assets to $tag..." -ForegroundColor Cyan

$fixedExe = "$bundle\adris-setup.exe"
Copy-Item $exe $fixedExe

& $gh release upload $tag $exe $sig latest.json $fixedExe --repo astraluxe/nivara-desktop --clobber

Remove-Item $fixedExe -ErrorAction SilentlyContinue

if ($LASTEXITCODE -ne 0) {
    Write-Host "Upload failed. Upload these manually to the $tag release:" -ForegroundColor Yellow
    Write-Host "  $exe"
    Write-Host "  $sig"
    Write-Host "  latest.json"
    Write-Host "  (also re-run to upload adris-setup.exe for the download page)"
    exit 1
}

# -- Mirror latest.json where blocked networks can still reach it ------------------------------
#
# Measured on a real Indian ISP: objects.githubusercontent.com and release-assets.githubusercontent.com
# resolve to GitHub's normal CDN IPs and accept a TCP connection on 443, then never complete the TLS
# handshake -- SNI-based filtering. Every release file is served from those two hosts, so the updater
# could not even READ latest.json and reported "check your connection" at someone whose connection
# was fine. github.com itself, raw.githubusercontent.com and www.adris.tech are all reachable, so
# the manifest goes to those as well and the app tries them in order (see tauri.conf.json endpoints).
#
# The manifest is ~1 KB, so mirroring it costs nothing. The 24 MB installer is deliberately NOT
# mirrored here -- that is a repo-size decision, not a script one.
Write-Host ""
Write-Host "Mirroring latest.json to the reachable hosts..." -ForegroundColor Cyan

# 1. raw.githubusercontent.com -- commit it into this repo.
git add latest.json 2>$null
git commit -m "chore(release): latest.json for v$version" --only latest.json 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { git push 2>$null | Out-Null }
Write-Host "  raw.githubusercontent.com: committed" -ForegroundColor DarkGray

# 2. www.adris.tech -- the website repo is the parent folder and auto-deploys from master.
$siteRoot = Split-Path (Get-Location).Path -Parent
if (Test-Path (Join-Path $siteRoot "vercel.json")) {
    Copy-Item "latest.json" (Join-Path $siteRoot "latest.json") -Force
    Push-Location $siteRoot
    git add latest.json 2>$null
    git commit -m "chore: update manifest for adris.tech v$version" --only latest.json 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { git push 2>$null | Out-Null; Write-Host "  www.adris.tech: pushed (Vercel will deploy it)" -ForegroundColor DarkGray }
    else { Write-Host "  www.adris.tech: unchanged" -ForegroundColor DarkGray }
    Pop-Location
} else {
    Write-Host "  www.adris.tech: website repo not found next door -- skipped" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done! v$version is live with auto-update support." -ForegroundColor Green
Write-Host "Users will see an update prompt on next launch." -ForegroundColor Green
$dlUrl = "https://github.com/astraluxe/nivara-desktop/releases/latest/download/adris-setup.exe"
Write-Host "Download page URL: $dlUrl" -ForegroundColor Cyan
