#!/usr/bin/env pwsh
# Windows install script for Parlo app

param(
    [string]$IsNightly = "false"
)

$installerPath = "$env:TEMP\Parlo-installer.exe"
$isNightly = [System.Convert]::ToBoolean($IsNightly)

Write-Host "Installing Parlo app..."
Write-Host "Is nightly build: $isNightly"

# Try silent installation first
try {
    Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -NoNewWindow
    Write-Host "Parlo app installed silently"
}
catch {
    Write-Host "Silent installation failed, trying normal installation..."
    Start-Process -FilePath $installerPath -Wait -NoNewWindow
}

# Wait a bit for installation to complete
Start-Sleep -Seconds 10

Write-Host "[INFO] Waiting for Parlo app first initialization (120 seconds)..."
Write-Host "This allows Parlo to complete its initial setup and configuration"
Start-Sleep -Seconds 120
Write-Host "[SUCCESS] Initialization wait completed"

# Verify installation based on nightly flag
if ($isNightly) {
    $defaultParloPath = "$env:LOCALAPPDATA\Programs\Parlo-nightly\Parlo-nightly.exe"
    $processName = "Parlo-nightly.exe"
} else {
    $defaultParloPath = "$env:LOCALAPPDATA\Programs\Parlo\Parlo.exe"
    $processName = "Parlo.exe"
}

if (Test-Path $defaultParloPath) {
    Write-Host "Parlo app installed successfully at: $defaultParloPath"
    Write-Output "PARLO_APP_PATH=$defaultParloPath" >> $env:GITHUB_ENV
    Write-Output "PARLO_PROCESS_NAME=$processName" >> $env:GITHUB_ENV
} else {
    Write-Warning "Parlo app not found at expected location: $defaultParloPath"
    Write-Host "Will auto-detect during test run"
}
