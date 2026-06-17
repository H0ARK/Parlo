#!/usr/bin/env pwsh
# Windows test runner script

param(
    [string]$ParloAppPath,
    [string]$ProcessName,
    [string]$RpToken
)

Write-Host "Starting Auto QA Tests..."

Write-Host "Parlo app path: $ParloAppPath"
Write-Host "Process name: $ProcessName"
Write-Host "Current working directory: $(Get-Location)"
Write-Host "Contents of current directory:"
Get-ChildItem
Write-Host "Contents of trajectories directory (if exists):"
if (Test-Path "trajectories") {
    Get-ChildItem "trajectories"
} else {
    Write-Host "trajectories directory not found"
}

# Run the main test with proper arguments
if ($ParloAppPath -and $ProcessName) {
    python main.py --enable-reportportal --rp-token "$RpToken" --Parlo-app-path "$ParloAppPath" --Parlo-process-name "$ProcessName"
} elseif ($ParloAppPath) {
    python main.py --enable-reportportal --rp-token "$RpToken" --Parlo-app-path "$ParloAppPath"
} else {
    python main.py --enable-reportportal --rp-token "$RpToken"
}
