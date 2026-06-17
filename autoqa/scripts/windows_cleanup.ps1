#!/usr/bin/env pwsh
# Windows cleanup script for Parlo app

param(
    [string]$IsNightly = "false"
)

Write-Host "Cleaning existing Parlo installations..."

# Remove Parlo data folders (both regular and nightly)
$parloAppData = "$env:APPDATA\Parlo"
$parloNightlyAppData = "$env:APPDATA\Parlo-nightly"
$parloLocalAppData = "$env:LOCALAPPDATA\Parlo.ai.app"
$parloNightlyLocalAppData = "$env:LOCALAPPDATA\Parlo-nightly.ai.app"

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


# Kill any running Parlo processes (both regular and nightly)
Get-Process -Name "Parlo" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "Parlo" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "Parlo-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "Parlo-nightly" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Remove Parlo extensions folder
$parloExtensionsPath = "$env:USERPROFILE\Parlo\extensions"
if (Test-Path $parloExtensionsPath) {
    Write-Host "Removing $parloExtensionsPath"
    Remove-Item -Path $parloExtensionsPath -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Parlo cleanup completed"
