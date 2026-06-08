# Build a signed release for auto-update support.
# Usage (from nivara-desktop folder):
#   .\scripts\build-signed.ps1

Set-Location "$PSScriptRoot\.."

$keyFile = ".tauri\nivara.key"
if (-not (Test-Path $keyFile)) {
    Write-Host "ERROR: .tauri\nivara.key not found." -ForegroundColor Red
    exit 1
}

# Set signing env vars — Tauri reads these during build and auto-generates .sig
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $keyFile -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""

# Build
$version = (Get-Content "src-tauri/tauri.conf.json" | ConvertFrom-Json).version
Write-Host "Building v$version..." -ForegroundColor Cyan
npm run tauri build
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed." -ForegroundColor Red; exit 1 }

# Paths
$bundle = "src-tauri\target\release\bundle\nsis"
$exe    = "$bundle\adris.tech_${version}_x64-setup.exe"
$sig    = "$bundle\adris.tech_${version}_x64-setup.exe.sig"

# If Tauri didn't auto-sign (createUpdaterArtifacts), sign manually
if (-not (Test-Path $sig)) {
    Write-Host "Auto-sign not detected — signing manually..." -ForegroundColor Yellow
    $absKey = (Resolve-Path $keyFile).Path
    $absExe = (Resolve-Path $exe).Path
    npx tauri signer sign -f $absKey -p "" $absExe
}

if (-not (Test-Path $sig)) {
    Write-Host "ERROR: Signing failed. .sig not produced." -ForegroundColor Red
    exit 1
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
$latest | ConvertTo-Json -Depth 5 | Set-Content "latest.json" -Encoding UTF8
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
& $gh release upload $tag $exe $sig latest.json --repo astraluxe/nivara-desktop --clobber

if ($LASTEXITCODE -ne 0) {
    Write-Host "Upload failed. Upload these manually to the $tag release:" -ForegroundColor Yellow
    Write-Host "  $exe"; Write-Host "  $sig"; Write-Host "  latest.json"
    exit 1
}

Write-Host ""
Write-Host "Done! v$version is live with auto-update support." -ForegroundColor Green
Write-Host "Existing users will see an update prompt on next launch." -ForegroundColor Green
