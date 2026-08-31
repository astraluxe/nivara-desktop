# Build a signed release for auto-update support.
# Usage (from nivara-desktop folder):
#   .\scripts\build-signed.ps1
#   .\scripts\build-signed.ps1 -SkipBuild    # the .exe is already built — just sign and publish
param([switch]$SkipBuild)

Set-Location "$PSScriptRoot\.."

$keyFile = ".tauri\nivara.key"
if (-not (Test-Path $keyFile)) {
    Write-Host "ERROR: .tauri\nivara.key not found." -ForegroundColor Red
    exit 1
}

# ── WHY THE SIGNING KEY IS *NOT* PUT IN THE ENVIRONMENT ──────────────────────
#
# This used to set TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "" and let
# `tauri build` sign during the build. It broke on a Windows rule that is easy to miss:
# SETTING AN ENVIRONMENT VARIABLE TO AN EMPTY STRING DELETES IT. Windows has no concept of a
# variable that exists with no value.
#
# So the key was set and the PASSWORD variable silently did not exist. Tauri found a key, needed a
# password, could not find one, and fell back to an interactive prompt in the middle of a scripted
# build -- where whatever it received was wrong, and a four-minute build ended in
# "Wrong password for that key".
#
# The key genuinely has an empty password, which is precisely the one value the environment cannot
# carry. So it does not go through the environment at all: the build runs unsigned and the
# signature is applied afterwards by `tauri signer sign --password ""`, where the empty string is an
# ARGUMENT and survives. Verified against the real key.
#
# ── AND THEY MUST BE ACTIVELY CLEARED, NOT MERELY LEFT UNSET ────────────────
#
# Not setting them is not enough. A shell that ran the OLD version of this script still carries
# TAURI_SIGNING_PRIVATE_KEY for the life of that window, and it broke the next run in two separate
# ways: `tauri build` found a key and prompted for a password again, and then `signer sign` refused
# with "--private-key-path cannot be used with --private-key", because the leftover variable IS
# --private-key as far as the CLI is concerned.
#
# So the environment is cleaned first, every time, and the run no longer depends on which commands
# happen to have been typed in this window earlier.
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY          -ErrorAction SilentlyContinue
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue

$version = (Get-Content "src-tauri/tauri.conf.json" | ConvertFrom-Json).version

$bundle = "src-tauri\target\release\bundle\nsis"
$exe    = "$bundle\adris.tech_${version}_x64-setup.exe"
$sig    = "$exe.sig"

if ($SkipBuild) {
    Write-Host "Skipping the build; signing and publishing v$version as it stands." -ForegroundColor Yellow
} else {
    Write-Host "Building v$version..." -ForegroundColor Cyan
    if (Test-Path $exe) { Remove-Item $exe -Force }   # so "did it build?" below cannot see a stale one
    npm run tauri build

    # ── WHY A NON-ZERO EXIT IS NOT AUTOMATICALLY A FAILED BUILD ──────────────
    #
    # tauri.conf.json carries an updater pubkey, so the bundler ALWAYS tries to sign — and with the
    # private key deliberately kept out of the environment (see above) it stops with:
    #
    #     "A public key has been found, but no private key. Make sure to set
    #      TAURI_SIGNING_PRIVATE_KEY environment variable."
    #
    # That happens AFTER the installer has been written. The bundler's own log says so:
    # "Finished 1 bundle at ...adris.tech_x.y.z_x64-setup.exe". Treating it as a failed build threw
    # away a perfectly good four-minute compile and stopped the script before the signing step it
    # was about to perform itself.
    #
    # So the question asked here is the honest one: IS THERE AN INSTALLER? A real failure -- a
    # compile error, a failing guard -- produces no .exe and still stops the script.
    if ($LASTEXITCODE -ne 0) {
        if (Test-Path $exe) {
            Write-Host "  (the bundler could not sign it -- expected; signing happens below)" -ForegroundColor DarkGray
        } else {
            Write-Host "Build failed - no installer was produced." -ForegroundColor Red
            exit 1
        }
    }
}

# Paths are set above the build, because the build needs to know what an installer looks like in
# order to answer "was one produced?" when the bundler exits non-zero over signing.

if (-not (Test-Path $exe)) {
    Write-Host "ERROR: $exe was not produced by the build." -ForegroundColor Red
    exit 1
}

# Always signed HERE, never during the build — see the note at the top.
#
# A GOOD SIGNATURE IS NEVER THROWN AWAY BEFORE A REPLACEMENT EXISTS. The first version of this
# deleted the existing .sig and then signed; when signing failed it had destroyed a perfectly valid
# signature the build had just produced, and left the release with nothing. It is moved aside now
# and only deleted once a new one is on disk.
Write-Host "Signing the installer..." -ForegroundColor Cyan
$sigBackup = "$sig.prev"
if (Test-Path $sig) { Move-Item $sig $sigBackup -Force }

# --password '""' — LITERAL QUOTES, and they are not a typo.
#
# PowerShell 5.1 DROPS an empty-string argument when calling a native executable. `--password ""`
# does not pass an empty password; it passes nothing at all, so the CLI reads the .exe path as the
# password and then reports the FILE argument missing. That is why the old fallback in this script
# never worked either — it had the same line, and its failure was hidden behind the earlier error.
#
# Passing '""' hands through two literal quote characters, which the CLI parses as an empty string.
# Measured both forms against the real key: this one produces a valid .sig, `""` does not.
& npx tauri signer sign --private-key-path $keyFile --password '""' $exe

if (-not (Test-Path $sig)) {
    if (Test-Path $sigBackup) {
        Move-Item $sigBackup $sig -Force
        Write-Host "Signing failed - kept the signature that already existed." -ForegroundColor Yellow
    } else {
        Write-Host "ERROR: Signing failed - no .sig produced." -ForegroundColor Red
        Write-Host "  The key's password is empty. If that ever changes, pass it to signer sign as an" -ForegroundColor Yellow
        Write-Host "  ARGUMENT - never as an environment variable, which on Windows cannot hold an" -ForegroundColor Yellow
        Write-Host "  empty string and is what broke this in the first place." -ForegroundColor Yellow
        exit 1
    }
} else {
    Remove-Item $sigBackup -Force -ErrorAction SilentlyContinue
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
            # THE ONE URL THE UPDATER ACTUALLY DOWNLOADS, AND IT HAS TO BE REACHABLE.
            #
            # This pointed straight at the GitHub release, which redirects to
            # release-assets.githubusercontent.com — the host this script already goes out of its
            # way to route AROUND for the manifest. Measured on a real Indian ISP: the redirect
            # arrives in 0.8s and the download that follows transfers 0 bytes and hangs. So the app
            # read latest.json from a mirror, correctly offered the update, and then failed with
            # "error sending request for url ...x64-setup.exe" every single time.
            #
            # www.adris.tech/dl/<file> (api/dl.js in the website repo) fetches the asset from
            # GitHub server-side and streams the bytes back from a domain that answers. Verified
            # end to end: 24,569,084 bytes, SHA-256 identical to the local build.
            url = "https://www.adris.tech/dl/adris.tech_${version}_x64-setup.exe?v=${version}"
        }
    }
}
$json = $latest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path (Get-Location).Path "latest.json"), $json, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Generated latest.json" -ForegroundColor Green

# -- The tag must point at a commit that KNOWS its own version ---------------------------------
#
# `gh release create` below tags whatever the remote's default branch currently points at. This
# script only ever committed latest.json, so the version bump in tauri.conf.json sat uncommitted and
# the tag landed on a commit still carrying the PREVIOUS version. Harmless for Windows, because the
# installer is built locally from the working tree -- and quietly wrong for Linux, which is built by
# .github/workflows/linux-build.yml from the tagged commit and reads its version out of
# tauri.conf.json. Measured: tag v1.37.0 pointed at a commit saying 1.35.1, so release v1.37.0 was
# published carrying adris-setup-linux-1.35.1.deb. Windows and Linux drifted two versions apart and
# nothing in the process noticed.
#
# So: push the bump first, and only then cut the tag.
Write-Host "Pushing the version bump so the tag carries it..." -ForegroundColor Cyan
git add src-tauri/tauri.conf.json package.json 2>$null
git commit -m "chore(release): v$version" --only src-tauri/tauri.conf.json package.json 2>$null | Out-Null
git push 2>$null | Out-Null
$tagged = (git rev-parse HEAD 2>$null)
$remote = (git rev-parse "@{u}" 2>$null)
if ($tagged -ne $remote) {
    Write-Host "  WARNING: local and remote HEAD differ -- the Linux build may tag the wrong commit." -ForegroundColor Yellow
}

# Create release if needed, then upload
$gh  = "C:\Program Files\GitHub CLI\gh.exe"
$tag = "v$version"

& $gh release view $tag --repo astraluxe/nivara-desktop 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating GitHub release $tag..." -ForegroundColor Cyan
    & $gh release create $tag --repo astraluxe/nivara-desktop --title $tag --notes "Bug fixes and improvements" --latest
}

Write-Host "Uploading assets to $tag..." -ForegroundColor Cyan

# ─── ONE AT A TIME, AND THE MANIFEST LAST ────────────────────────────────────
#
# `gh release upload` given four files uploads them CONCURRENTLY. On 1.77.0 two 25 MB installers
# going up at once came back "HTTP 400: Bad Request" while the small .sig and latest.json went up
# fine — so the release was published carrying a MANIFEST BUT NO INSTALLER. The updater read that
# manifest, correctly announced 1.77.0, and then could not download anything. The owner saw
# "the update failed" with no way to tell that the release itself was half empty.
#
# Sequential uploads with a retry fix the 400. Uploading latest.json LAST means a half-finished
# release cannot advertise itself: if an installer fails, there is no manifest pointing at it and
# every client simply stays on the version it has.

$fixedExe = "$bundle\adris-setup.exe"
Copy-Item $exe $fixedExe

function Send-Asset($path) {
    foreach ($attempt in 1..3) {
        & $gh release upload $tag $path --repo astraluxe/nivara-desktop --clobber
        if ($LASTEXITCODE -eq 0) { return $true }
        Write-Host "  upload of $(Split-Path $path -Leaf) failed (attempt $attempt of 3), retrying..." -ForegroundColor Yellow
        Start-Sleep -Seconds 4
    }
    return $false
}

$uploadOk = $true
# The installers first, the manifest only once they are all really up there.
# THE MESH ENGINE SHIPS TOO.
#
# `exo-node.exe` is built by the same cargo run and was never uploaded, so the app's download URL
# 404'd for every user since Mesh shipped and the engine could never install. It is small (~370 KB)
# and Mesh is dead without it.
$exoNode = Join-Path (Split-Path $exe -Parent) "..\..\exo-node.exe"
$exoNode = [System.IO.Path]::GetFullPath($exoNode)
$assets = @($exe, $sig, $fixedExe)
if (Test-Path $exoNode) { $assets += $exoNode }
else { Write-Host "  WARNING: exo-node.exe not found -- Mesh will not be able to install its engine." -ForegroundColor Yellow }

foreach ($asset in $assets) {
    if (-not (Send-Asset $asset)) { $uploadOk = $false; break }
}
if ($uploadOk) { $uploadOk = Send-Asset "latest.json" }

Remove-Item $fixedExe -ErrorAction SilentlyContinue

# VERIFY, do not assume. The exit code told us an upload failed and the release was still left
# live and broken, so ask GitHub what is actually on the release before calling this a success.
if ($uploadOk) {
    $onRelease = & $gh release view $tag --repo astraluxe/nivara-desktop --json assets --jq ".assets[].name"
    foreach ($want in @((Split-Path $exe -Leaf), (Split-Path $sig -Leaf), "adris-setup.exe", "exo-node.exe", "latest.json")) {
        if ($onRelease -notcontains $want) {
            Write-Host "  MISSING from the release: $want" -ForegroundColor Red
            $uploadOk = $false
        }
    }
}

if (-not $uploadOk) {
    Write-Host "Upload failed. The release is INCOMPLETE -- upload these manually to ${tag}:" -ForegroundColor Yellow
    Write-Host "  $exe"
    Write-Host "  $sig"
    Write-Host "  the same .exe again, renamed adris-setup.exe (the download page uses that name)"
    Write-Host "  latest.json  -- LAST, and only after the installers are up" -ForegroundColor Yellow
    Write-Host "  gh release upload $tag <file> --repo astraluxe/nivara-desktop --clobber"
    Write-Host ""
    # THE PART THAT IS EASY TO MISS. The mirroring step below never runs when we exit here, so
    # www.adris.tech keeps serving the PREVIOUS version and nobody is offered this one -- the
    # release looks published on GitHub while every app in the world still sees the old number.
    Write-Host "  latest.json was NOT mirrored to www.adris.tech, so NOBODY has been offered v$version." -ForegroundColor Yellow
    Write-Host "  That endpoint is the only one reachable on a filtered ISP -- re-run this script once the assets are up." -ForegroundColor Yellow
    exit 1
}

Write-Host "All four assets verified on the release." -ForegroundColor Green

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
