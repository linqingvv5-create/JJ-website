$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root 'dist'
$client = Join-Path $dist 'client'
$server = Join-Path $dist 'server'

if (Test-Path -LiteralPath $dist) {
  $resolvedRoot = [IO.Path]::GetFullPath($root)
  $resolvedDist = [IO.Path]::GetFullPath($dist)
  if (-not $resolvedDist.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Unsafe dist path.'
  }
  Remove-Item -LiteralPath $resolvedDist -Recurse -Force
}

New-Item -ItemType Directory -Path $client -Force | Out-Null
New-Item -ItemType Directory -Path $server -Force | Out-Null

$assets = @(
  'finance.html',
  'style.css',
  'data.js',
  'trade-board.js',
  'sync-auth.js',
  'manifest.webmanifest',
  'finance-manifest.webmanifest',
  'app-icon.svg'
)
foreach ($asset in $assets) {
  Copy-Item -LiteralPath (Join-Path $root $asset) -Destination (Join-Path $client $asset) -Force
}
Copy-Item -LiteralPath (Join-Path $root 'finance.html') -Destination (Join-Path $client 'index.html') -Force
Copy-Item -LiteralPath (Join-Path $root 'worker\site-worker.js') -Destination (Join-Path $server 'index.js') -Force

$wrangler = @{
  main = 'index.js'
  compatibility_date = '2026-05-15'
  compatibility_flags = @('nodejs_compat')
  assets = @{ directory = '../client' }
  d1_databases = @(@{
    binding = 'DB'
    database_name = 'linqing-trading-dashboard-db'
    database_id = '00000000-0000-4000-8000-000000000000'
  })
} | ConvertTo-Json -Depth 6 -Compress
Set-Content -LiteralPath (Join-Path $server 'wrangler.json') -Value $wrangler -Encoding UTF8

Write-Output "Built $dist"
