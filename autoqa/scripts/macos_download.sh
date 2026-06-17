#!/bin/bash
# macOS download script for Parlo app

WORKFLOW_INPUT_URL="$1"
WORKFLOW_INPUT_IS_NIGHTLY="$2"
REPO_VARIABLE_URL="$3"
REPO_VARIABLE_IS_NIGHTLY="$4"
DEFAULT_URL="$5"
DEFAULT_IS_NIGHTLY="$6"

# Determine Parlo app URL and nightly flag from multiple sources (priority order):
# 1. Workflow dispatch input (manual trigger)
# 2. Repository variable PARLO_APP_URL
# 3. Default URL from env

PARLO_APP_URL=""
IS_NIGHTLY="false"

if [ -n "$WORKFLOW_INPUT_URL" ]; then
    PARLO_APP_URL="$WORKFLOW_INPUT_URL"
    IS_NIGHTLY="$WORKFLOW_INPUT_IS_NIGHTLY"
    echo "Using Parlo app URL from workflow input: $PARLO_APP_URL"
    echo "Is nightly build: $IS_NIGHTLY"
elif [ -n "$REPO_VARIABLE_URL" ]; then
    PARLO_APP_URL="$REPO_VARIABLE_URL"
    IS_NIGHTLY="$REPO_VARIABLE_IS_NIGHTLY"
    echo "Using Parlo app URL from repository variable: $PARLO_APP_URL"
    echo "Is nightly build: $IS_NIGHTLY"
else
    PARLO_APP_URL="$DEFAULT_URL"
    IS_NIGHTLY="$DEFAULT_IS_NIGHTLY"
    echo "Using default Parlo app URL: $PARLO_APP_URL"
    echo "Is nightly build: $IS_NIGHTLY"
fi

# Export for later steps
echo "PARLO_APP_URL=$PARLO_APP_URL" >> $GITHUB_ENV
echo "IS_NIGHTLY=$IS_NIGHTLY" >> $GITHUB_ENV

echo "Downloading Parlo app from: $PARLO_APP_URL"
curl -L -o "/tmp/Parlo-installer.dmg" "$PARLO_APP_URL"

if [ ! -f "/tmp/Parlo-installer.dmg" ]; then
    echo "[FAILED] Failed to download Parlo app"
    exit 1
fi

echo "[SUCCESS] Successfully downloaded Parlo app"
ls -la "/tmp/Parlo-installer.dmg"
