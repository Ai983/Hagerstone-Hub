# ============================================================================
#  Hiring System — Supabase backup script
#  Project: sgerslbmnwrltqrhsdir  (moved to the FREE org 2026-07-16)
#
#  WHY THIS EXISTS: the free plan has NO automatic backups. This script takes
#  a full pg_dump of the Hiring System database so a bad DELETE / dropped table
#  / corrupted migration is recoverable. Run it weekly (or before any risky
#  change). It prompts for the DB password — nothing sensitive is stored here.
#
#  HOW TO RUN:
#    1. Open PowerShell in this folder (hagerstone-hub).
#    2. Run:   .\backup-hiring-system.ps1
#    3. Paste the DB password when prompted.
#
#  REQUIRES pg_dump v17. Check with:  pg_dump --version
#    If missing:  winget install PostgreSQL.PostgreSQL.17   (then reopen PowerShell)
# ============================================================================

# --- Connection details --------------------------------------------------
# HOST + PORT + USER come from the Supabase "Connection string" (Session pooler):
#   Hiring System -> Project Settings -> Database -> Connection string -> "Session pooler"
# It looks like:
#   postgresql://postgres.sgerslbmnwrltqrhsdir:[PASSWORD]@aws-1-<region>.pooler.supabase.com:5432/postgres
# Copy the host from there and paste it below (replace the placeholder).
$DbHost   = "PASTE-POOLER-HOST-HERE.pooler.supabase.com"   # e.g. aws-1-ap-south-1.pooler.supabase.com
$DbPort   = "5432"                                          # session pooler = 5432 (use 6543 for transaction pooler)
$DbUser   = "postgres.sgerslbmnwrltqrhsdir"
$DbName   = "postgres"

# --- Output location -----------------------------------------------------
$Stamp    = Get-Date -Format "yyyy-MM-dd"
$OutDir   = Join-Path $PSScriptRoot "backups\hiring-system\$Stamp"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$DumpFile = Join-Path $OutDir "hiring_system_full.dump"
$LogFile  = Join-Path $OutDir "hiring_system_dump.log"

# --- Guard: host not filled in ------------------------------------------
if ($DbHost -like "PASTE-*") {
    Write-Host "ERROR: Edit this script and set `$DbHost from the Supabase connection string first." -ForegroundColor Red
    exit 1
}

# --- Prompt for password securely (never written to disk) ----------------
$SecurePwd = Read-Host "Enter Hiring System DB password" -AsSecureString
$env:PGPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePwd))

Write-Host "Dumping Hiring System -> $DumpFile ..." -ForegroundColor Cyan

# --- The dump ------------------------------------------------------------
pg_dump `
  --host=$DbHost `
  --port=$DbPort `
  --username=$DbUser `
  --dbname=$DbName `
  --format=custom `
  --no-owner `
  --no-acl `
  --verbose `
  --file=$DumpFile 2>&1 | Out-File -FilePath $LogFile -Encoding utf8

# --- Clear the password from the session immediately ---------------------
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

# --- Verify --------------------------------------------------------------
if (Test-Path $DumpFile) {
    $sizeMB = [math]::Round((Get-Item $DumpFile).Length / 1MB, 2)
    Write-Host "`nDone. Dump size: $sizeMB MB" -ForegroundColor Green
    if ($sizeMB -lt 0.5) {
        Write-Host "WARNING: dump is suspiciously small — check $LogFile for errors." -ForegroundColor Yellow
    }
    Write-Host "`nTables captured (first 40 lines of the dump manifest):" -ForegroundColor Cyan
    pg_restore --list $DumpFile | Select-Object -First 40
    Write-Host "`nBackup saved to: $OutDir" -ForegroundColor Green
    Write-Host "TIP: also copy this folder off your laptop (Google Drive / USB) so it survives a disk failure." -ForegroundColor DarkGray
} else {
    Write-Host "`nFAILED: no dump file produced. Check the log:" -ForegroundColor Red
    Write-Host "  $LogFile"
    Write-Host "Common cause: wrong host/username. Username must be 'postgres.sgerslbmnwrltqrhsdir'." -ForegroundColor DarkGray
}
