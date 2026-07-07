param(
  [string]$Host = "0.0.0.0",
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundledPython = "C:\Users\么么\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

function Find-PythonCommand {
  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonCommand) {
    return @{
      Type = "python"
      Path = $pythonCommand.Source
    }
  }

  $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($pyLauncher) {
    return @{
      Type = "py"
      Path = $pyLauncher.Source
    }
  }

  if (Test-Path -LiteralPath $bundledPython) {
    return @{
      Type = "python"
      Path = $bundledPython
    }
  }

  return $null
}

$pythonInfo = Find-PythonCommand
if (-not $pythonInfo) {
  throw "未找到可用的 Python。请先安装 Python，或在 Codex 环境内运行此脚本。"
}

Write-Host "Using Python:" $pythonInfo.Path
Set-Location -LiteralPath $root

if ($pythonInfo.Type -eq "py") {
  & $pythonInfo.Path -3 server.py --host $Host --port $Port
  exit $LASTEXITCODE
}

& $pythonInfo.Path server.py --host $Host --port $Port
exit $LASTEXITCODE
