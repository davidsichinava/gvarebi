<#
.SYNOPSIS
  Rebuild the payload and the site, from PowerShell.

.DESCRIPTION
  Runs the pipeline end to end: R build -> validate -> vite build. Two things
  here that a bare `npm run ...` sequence gets wrong on this machine:

  1. Windows PowerShell 5.1 has no `&&`, so a plain one-liner chain silently
     carries on after a failure. Each step below is checked.
  2. Dropbox indexes dist\data and dist\tiles while vite is trying to empty
     them, so the build intermittently dies with EPERM. That is not a real
     build failure and it clears on a retry.

.PARAMETER SkipData
  Skip the R stage and rebuild only the site from the existing payload.

.PARAMETER Preview
  Serve the built site on http://localhost:4173 when finished.

.EXAMPLE
  .\tools\rebuild.ps1
.EXAMPLE
  .\tools\rebuild.ps1 -SkipData -Preview
#>
[CmdletBinding()]
param(
  [switch] $SkipData,
  [switch] $Preview,
  [int]    $BuildRetries = 4
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "   $text" -ForegroundColor Red; Pop-Location; exit 1 }

# Every native command here writes to stderr on a perfectly good run - Rscript
# announces which R version its packages were built under, vite prints its
# banner. Windows PowerShell turns native stderr into ErrorRecords whenever the
# stream is captured or piped, and under ErrorActionPreference=Stop that is a
# terminating error: the script dies on a warning while the tool it called
# exited 0. So every native call goes through here, where the preference is
# relaxed and the exit code - the only reliable signal - is what gets returned.
function Invoke-Native {
  param([string] $Exe, [string[]] $Arguments, [switch] $Capture)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($Capture) { $out = & $Exe @Arguments 2>&1 | Out-String }
    else          { & $Exe @Arguments 2>&1 | ForEach-Object { Write-Host $_ }; $out = '' }
    return [pscustomobject]@{ Code = $LASTEXITCODE; Output = $out }
  } finally { $ErrorActionPreference = $prev }
}

try {
  # A running dev or preview server keeps a handle on dist and guarantees the
  # EPERM below, so clear them out first.
  Step 'stopping any dev/preview server'
  $procs = Get-NetTCPConnection -LocalPort 4173, 5173 -State Listen -ErrorAction SilentlyContinue |
           Select-Object -ExpandProperty OwningProcess -Unique |
           Where-Object { $_ }
  if ($procs) {
    $procs | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    Write-Host "   stopped $($procs.Count)"
    Start-Sleep -Seconds 2
  } else {
    Write-Host '   none running'
  }

  if (-not $SkipData) {
    Step 'npm run data   (R pipeline, ~2-3 min)'
    $t = Get-Date
    $r = Invoke-Native npm @('run', 'data')
    if ($r.Code -ne 0) { Fail "the R build failed with exit code $($r.Code)" }
    Write-Host ("   {0:n1} min" -f ((Get-Date) - $t).TotalMinutes)
  }

  Step 'npm run check   (validate the payload)'
  $r = Invoke-Native npm @('run', 'check')
  if ($r.Code -ne 0) { Fail 'the payload did not validate - fix that before building' }

  Step 'npm run build'
  $built = $false
  for ($i = 1; $i -le $BuildRetries -and -not $built; $i++) {
    $r = Invoke-Native npm @('run', 'build') -Capture
    $out = $r.Output
    if ($r.Code -eq 0) {
      $built = $true
    } elseif ($out -match 'EPERM') {
      Write-Host "   attempt ${i}: Dropbox is holding dist, retrying" -ForegroundColor Yellow
      Start-Sleep -Seconds ([math]::Min(20, 5 * $i))
    } else {
      Write-Host $out
      Fail "the build failed for a reason other than EPERM"
    }
  }
  if (-not $built) { Fail "the build kept hitting EPERM. Pause Dropbox syncing and run it again." }

  $files = (Get-ChildItem dist -Recurse -File | Measure-Object).Count
  $mb    = [math]::Round((Get-ChildItem dist -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
  Write-Host "`nsite built: $files files, $mb MB in dist\" -ForegroundColor Green
  Write-Host 'publish it with:  npm run deploy'

  if ($Preview) {
    Step 'serving on http://localhost:4173  (Ctrl+C to stop)'
    Invoke-Native npm @('run', 'preview') | Out-Null
  }
}
finally {
  Pop-Location
}
