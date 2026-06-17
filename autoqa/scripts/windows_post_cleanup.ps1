#!/usr/bin/env pwsh
# Windows post-test cleanup script

param(
    [string]$IsNightly = "false"
)

Write-Host "Cleaning up after tests..."

# Kill any running Parlo processes (both regular and nightly)
Get-Process -Name "Parlo" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "Parlo" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "Parlo-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "Parlo-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Remove Parlo data folders (both regular and nightly)
$parloAppData = "$env:APPDATA\Parlo"
$parloNightlyAppData = "$env:APPDATA\Parlo-nightly"
$parloLocalAppData = "$env:LOCALAPPDATA\Parlo.ai.app"
$parloNightlyLocalAppData = "$env:LOCALAPPDATA\Parlo-nightly.ai.app"
$parloProgramsPath = "$env:LOCALAPPDATA\Programs\Parlo"
$parloNightlyProgramsPath = "$env:LOCALAPPDATA\Programs\Parlo-nightly"

if (Test-Path $parloAppData) {
    Write-Host "Removing $parloAppData"
    Remove-Item -Path $parloAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $parloNightlyAppData) {
    Write-Host "Removing $parloNightlyAppData"
    Remove-Item -Path $parloNightlyAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $parloLocalAppData) {
    Write-Host "Removing $parloLocalAppData"
    Remove-Item -Path $parloLocalAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $parloNightlyLocalAppData) {
    Write-Host "Removing $parloNightlyLocalAppData"
    Remove-Item -Path $parloNightlyLocalAppData -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $parloProgramsPath) {
    Write-Host "Removing $parloProgramsPath"
    Remove-Item -Path $parloProgramsPath -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $parloNightlyProgramsPath) {
    Write-Host "Removing $parloNightlyProgramsPath"
    Remove-Item -Path $parloNightlyProgramsPath -Recurse -Force -ErrorAction SilentlyContinue
}

# Remove Parlo extensions folder
$parloExtensionsPath = "$env:USERPROFILE\Parlo\extensions"
if (Test-Path $parloExtensionsPath) {
    Write-Host "Removing $parloExtensionsPath"
    Remove-Item -Path $parloExtensionsPath -Recurse -Force -ErrorAction SilentlyContinue
}

# Try to uninstall Parlo app silently
try {
    $isNightly = [System.Convert]::ToBoolean($IsNightly)

    # Determine uninstaller path based on nightly flag
    if ($isNightly) {
        $uninstallerPath = "$env:LOCALAPPDATA\Programs\Parlo-nightly\uninstall.exe"
        $installPath = "$env:LOCALAPPDATA\Programs\Parlo-nightly"
    } else {
        $uninstallerPath = "$env:LOCALAPPDATA\Programs\Parlo\uninstall.exe"
        $installPath = "$env:LOCALAPPDATA\Programs\Parlo"
    }

    Write-Host "Looking for uninstaller at: $uninstallerPath"

    if (Test-Path $uninstallerPath) {
        Write-Host "Found uninstaller, attempting silent uninstall..."
        Start-Process -FilePath $uninstallerPath -ArgumentList "/S" -Wait -NoNewWindow -ErrorAction SilentlyContinue
        Write-Host "Uninstall completed"
    } else {
        Write-Host "No uninstaller found, attempting manual cleanup..."

        if (Test-Path $installPath) {
            Write-Host "Removing installation directory: $installPath"
            Remove-Item -Path $installPath -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Host "Parlo app cleanup completed"
}
catch {
    Write-Warning "Failed to uninstall Parlo app cleanly: $_"
    Write-Host "Manual cleanup may be required"
}

# Clean up downloaded installer
$installerPath = "$env:TEMP\Parlo-installer.exe"
if (Test-Path $installerPath) {
    Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
}

Write-Host "Cleanup completed"
