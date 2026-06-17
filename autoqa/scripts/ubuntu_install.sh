#!/bin/bash
# Ubuntu install script for Parlo app

IS_NIGHTLY="$1"

INSTALLER_PATH="/tmp/Parlo-installer.deb"

echo "Installing Parlo app..."
echo "Is nightly build: $IS_NIGHTLY"

# Install the .deb package
sudo apt install "$INSTALLER_PATH" -y
sudo apt-get install -f -y

# Wait for installation to complete
sleep 10

echo "[INFO] Waiting for Parlo app first initialization (120 seconds)..."
echo "This allows Parlo to complete its initial setup and configuration"
sleep 120
echo "[SUCCESS] Initialization wait completed"

# Verify installation based on nightly flag
if [ "$IS_NIGHTLY" = "true" ]; then
    DEFAULT_PARLO_PATH="/usr/bin/Parlo-nightly"
    PROCESS_NAME="Parlo-nightly"
else
    DEFAULT_PARLO_PATH="/usr/bin/Parlo"
    PROCESS_NAME="Parlo"
fi

if [ -f "$DEFAULT_PARLO_PATH" ]; then
    echo "Parlo app installed successfully at: $DEFAULT_PARLO_PATH"
    echo "PARLO_APP_PATH=$DEFAULT_PARLO_PATH" >> $GITHUB_ENV
    echo "PARLO_PROCESS_NAME=$PROCESS_NAME" >> $GITHUB_ENV
else
    echo "Parlo app not found at expected location: $DEFAULT_PARLO_PATH"
    echo "Will auto-detect during test run"
fi
