#!/usr/bin/env pwsh
# Windows download script for Parlo app

param(
    [string]$WorkflowInputUrl = "",
    [string]$WorkflowInputIsNightly = "",
    [string]$RepoVariableUrl = "",
    [string]$RepoVariableIsNightly = "",
    [string]$DefaultUrl = "",
    [string]$DefaultIsNightly = ""
)

# Determine Parlo app URL and nightly flag from multiple sources (priority order):
# 1. Workflow dispatch input (manual trigger)
# 2. Repository variable PARLO_APP_URL
# 3. Default URL from env

$parloAppUrl = ""
$isNightly = $false

if ($WorkflowInputUrl -ne "") {
    $parloAppUrl = $WorkflowInputUrl
    $isNightly = [System.Convert]::ToBoolean($WorkflowInputIsNightly)
    Write-Host "Using Parlo app URL from workflow input: $parloAppUrl"
    Write-Host "Is nightly build: $isNightly"
}
elseif ($RepoVariableUrl -ne "") {
    $parloAppUrl = $RepoVariableUrl
    $isNightly = [System.Convert]::ToBoolean($RepoVariableIsNightly)
    Write-Host "Using Parlo app URL from repository variable: $parloAppUrl"
    Write-Host "Is nightly build: $isNightly"
}
else {
    $parloAppUrl = $DefaultUrl
    $isNightly = [System.Convert]::ToBoolean($DefaultIsNightly)
    Write-Host "Using default Parlo app URL: $parloAppUrl"
    Write-Host "Is nightly build: $isNightly"
}

# Set environment variables for later steps
Write-Output "PARLO_APP_URL=$parloAppUrl" >> $env:GITHUB_ENV
Write-Output "IS_NIGHTLY=$isNightly" >> $env:GITHUB_ENV

Write-Host "Downloading Parlo app from: $parloAppUrl"

$downloadPath = "$env:TEMP\Parlo-installer.exe"

try {
    # Use wget for better performance
    wget.exe "$parloAppUrl" -O "$downloadPath"

    if (Test-Path $downloadPath) {
        $fileSize = (Get-Item $downloadPath).Length
        Write-Host "Downloaded Parlo app successfully. Size: $fileSize bytes"
        Write-Host "File saved to: $downloadPath"
    } else {
        throw "Downloaded file not found"
    }
}
catch {
    Write-Error "Failed to download Parlo app: $_"
    exit 1
}
