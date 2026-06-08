# Build a signed release for auto-update support.
#
# Usage:
#   $env:TAURI_SIGNING_PRIVATE_KEY = "<paste key here>"
#   .\scripts\build-signed.ps1
#
# Or with a key password:
#   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password>"
#   .\scripts\build-signed.ps1

Set-Location "$PSScriptRoot\.."

if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    Write-Host ""
    Write-Host "ERROR: TAURI_SIGNING_PRIVATE_KEY is not set." -ForegroundColor Red
    Write-Host "  Run:  `$env:TAURI_SIGNING_PRIVATE_KEY = '<paste key>'" -ForegroundColor Yellow
    Write-Host "  Then: .\scripts\build-signed.ps1" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# ── Build ──────────────────────────────────────────────────────────────────
Write-Host "Building v$(( Get-Content 'src-tauri/tauri.conf.json' | ConvertFrom-Json ).version)..." -ForegroundColor Cyan
npm run tauri build
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed." -ForegroundColor Red; exit 1 }

# ── Paths ──────────────────────────────────────────────────────────────────
$config  = Get-Content "src-tauri/tauri.conf.json" | ConvertFrom-Json
$version = $config.version
$bundle  = "src-tauri/target/release/bundle/nsis"
$exe     = "$bundle/adris.tech_${version}_x64-setup.exe"
$sig     = "$bundle/adris.tech_${version}_x64-setup.exe.sig"

if (-not (Test-Path $sig)) {
    Write-Host ""
    Write-Host "ERROR: .sig file was not generated." -ForegroundColor Red
    Write-Host "Check that TAURI_SIGNING_PRIVATE_KEY is the correct private key." -ForegroundColor Yellow
    exit 1
}

# ── Generate latest.json ───────────────────────────────────────────────────
$sigText = (Get-Content $sig -Raw).Trim()
$latest  = [ordered]@{
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

# ── Upload to GitHub Release ───────────────────────────────────────────────
$gh  = "C:\Program Files\GitHub CLI\gh.exe"
$tag = "v$version"

Write-Host "Uploading to GitHub release $tag..." -ForegroundColor Cyan
& $gh release upload $tag $exe $sig latest.json --repo astraluxe/nivara-desktop --clobber

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Upload failed. You can upload manually:" -ForegroundColor Yellow
    Write-Host "  $exe"
    Write-Host "  $sig"
    Write-Host "  latest.json"
    exit 1
}

Write-Host ""
Write-Host "Done! v$version is live with auto-update support." -ForegroundColor Green
Write-Host "Existing users will see an update prompt on next launch." -ForegroundColor Green
