# ============================================================
# Repo ZIP Backup Script
# ============================================================
# Creates ONE ZIP of the whole e-learning platform repo,
# keeping the original folder structure:
#
#   .github/  client/  database/  server/
#   .dockerignore  .env.example  .gitignore  docker-compose.yml
#   IMPROVEMENTS.md  package-lock.json  package.json
#   README.md  zip-util.ps1
#
# Place this script in the repo root and run it from PowerShell:
#   .\zip-util.ps1
#
# Output: zips\elearning-repo.zip
#
# Excludes:
#   - node_modules
#   - dist / build output
#   - .env files (real secrets) -- .env.example is KEPT
#   - the zips output folder itself, and any ZIP / 7z files
#   - .git folder (.github is KEPT)
#
# Requires 7-Zip
# ============================================================

$Root = $PSScriptRoot
$OutputDir = Join-Path $Root "zips"
$ZipName = "elearning-repo.zip"
$ZipPath = Join-Path $OutputDir $ZipName

# ------------------------------------------------------------
# Find 7-Zip
# ------------------------------------------------------------

$SevenZipPaths = @(
    "C:\Program Files\7-Zip\7z.exe",
    "C:\Program Files (x86)\7-Zip\7z.exe"
)

$SevenZip = $SevenZipPaths | Where-Object {
    Test-Path $_
} | Select-Object -First 1

if (-not $SevenZip) {
    Write-Host ""
    Write-Host "ERROR: 7-Zip was not found." -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install 7-Zip or update the 7z.exe path in this script."
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "Using 7-Zip: $SevenZip" -ForegroundColor Cyan

# ------------------------------------------------------------
# Prepare output directory (only replaces the previous repo zip)
# ------------------------------------------------------------

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

if (Test-Path $ZipPath) {
    Remove-Item $ZipPath -Force
}

# ------------------------------------------------------------
# Create the ZIP
# ------------------------------------------------------------

Write-Host ""
Write-Host "Creating: $ZipName" -ForegroundColor Green

# 7-Zip exclusions
# - "-xr!name" matches that exact file/folder name at any depth
# - "-x!zips" excludes only the root-level zips folder (so the
#   output never gets zipped into itself)
# - Real .env files are excluded, .env.example is kept on purpose
# - ".git" is an exact match, so ".github" and ".gitignore" are kept
$Arguments = @(
    "a"
    "-tzip"
    "`"$ZipPath`""
    "."
    "-x!zips"
    "-xr!node_modules"
    "-xr!dist"
    "-xr!build"
    "-xr!.git"
    "-xr!.env"
    "-xr!.env.local"
    "-xr!.env.*.local"
    "-xr!.env.development"
    "-xr!.env.production"
    "-xr!.env.test"
    "-xr!*.zip"
    "-xr!*.7z"
)

# Run 7-Zip from the repo root so the zip has no extra top-level path
Push-Location $Root

try {
    & $SevenZip $Arguments

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  SUCCESS: $ZipPath" -ForegroundColor Green
    }
    else {
        Write-Host "  ERROR: Failed to create $ZipName" -ForegroundColor Red
        exit 1
    }
}
finally {
    Pop-Location
}

# ------------------------------------------------------------
# Done
# ------------------------------------------------------------

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Full repo ZIP has been created." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Output file:"
Write-Host "  $ZipPath"
Write-Host ""