#!/bin/bash
# Ubuntu post-test cleanup script

IS_NIGHTLY="$1"

echo "Cleaning up after tests..."

# Kill any running Parlo processes (both regular and nightly)
pkill -f "Parlo" || true
pkill -f "Parlo" || true
pkill -f "Parlo-nightly" || true
pkill -f "Parlo-nightly" || true

# Remove Parlo data folders (both regular and nightly)
rm -rf ~/.config/Parlo
rm -rf ~/.config/Parlo-nightly
rm -rf ~/.local/share/Parlo
rm -rf ~/.local/share/Parlo-nightly
rm -rf ~/.cache/Parlo
rm -rf ~/.cache/Parlo-nightly
rm -rf ~/.local/share/Parlo-nightly.ai.app
rm -rf ~/.local/share/Parlo.ai.app

# Try to uninstall Parlo app
if [ "$IS_NIGHTLY" = "true" ]; then
    PACKAGE_NAME="Parlo-nightly"
else
    PACKAGE_NAME="Parlo"
fi

echo "Attempting to uninstall package: $PACKAGE_NAME"

if dpkg -l | grep -q "$PACKAGE_NAME"; then
    echo "Found package $PACKAGE_NAME, uninstalling..."
    sudo dpkg -r "$PACKAGE_NAME" || true
    sudo apt-get autoremove -y || true
else
    echo "Package $PACKAGE_NAME not found in dpkg list"
fi

# Clean up downloaded installer
rm -f "/tmp/Parlo-installer.deb"

echo "Cleanup completed"
