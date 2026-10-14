# ============================================================
# Repo ZIP Backup Script
# ============================================================
# Creates separate ZIP files for each part of the e-learning
# platform repo: client, server and database.
#
# Place this script in the repo root (next to client/, server/,
# database/) and run it from PowerShell:
#   .\zip-util.ps1
#
# Excludes:
#   - node_modules
#   - dist / build output
#   - .env files (real secrets) -- .env.example is KEPT
#   - existing ZIP / 7z files
#   - .git folders
#
# Requires 7-Zip
# ============================================================

$Root = $PSScriptRoot
$OutputDir = Join-Path $PSScriptRoot "zips"

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
# Create output directory
# ------------------------------------------------------------

if (Test-Path $OutputDir) {
    Remove-Item $OutputDir -Recurse -Force
}

New-Item -ItemType Directory -Path $OutputDir | Out-Null

# ------------------------------------------------------------
# Parts to ZIP
# ------------------------------------------------------------

$Parts = @("client", "server", "database")

# ------------------------------------------------------------
# Create ZIPs
# ------------------------------------------------------------

foreach ($Part in $Parts) {

    $SourceFolder = Join-Path $Root $Part
    $ZipName = "elearning-$Part.zip"
    $ZipPath = Join-Path $OutputDir $ZipName

    if (-not (Test-Path $SourceFolder)) {
        Write-Host ""
        Write-Host "WARNING: Folder not found:" -ForegroundColor Yellow
        Write-Host "  $SourceFolder"
        continue
    }

    Write-Host ""
    Write-Host "Creating: $ZipName" -ForegroundColor Green

    # 7-Zip exclusions
    # Real .env files are excluded, but .env.example is kept on purpose.
    $Arguments = @(
        "a"
        "-tzip"
        "`"$ZipPath`""
        "."
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

    # Run 7-Zip from inside the folder so the zip has no extra top-level path
    Push-Location $SourceFolder

    try {
        & $SevenZip $Arguments

        if ($LASTEXITCODE -eq 0) {
            Write-Host "  SUCCESS: $ZipPath" -ForegroundColor Green
        }
        else {
            Write-Host "  ERROR: Failed to create $ZipName" -ForegroundColor Red
        }
    }
    finally {
        Pop-Location
    }
}

# ------------------------------------------------------------
# Done
# ------------------------------------------------------------

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "client, server and database ZIPs have been created." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Output folder:"
Write-Host "  $OutputDir"
Write-Host ""
