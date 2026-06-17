#!/bin/bash
# macOS post-test cleanup script

echo "Cleaning up after tests..."

# Kill any running Parlo processes (both regular and nightly)
pkill -f "Parlo" || true
pkill -f "Parlo" || true
pkill -f "Parlo-nightly" || true
pkill -f "Parlo-nightly" || true

# Remove Parlo app directories
rm -rf /Applications/Parlo.app
rm -rf /Applications/Parlo-nightly.app
rm -rf ~/Applications/Parlo.app
rm -rf ~/Applications/Parlo-nightly.app

# Remove Parlo data folders (both regular and nightly)
rm -rf ~/Library/Application\ Support/Parlo
rm -rf ~/Library/Application\ Support/Parlo-nightly
rm -rf ~/Library/Application\ Support/Parlo.ai.app
rm -rf ~/Library/Application\ Support/Parlo-nightly.ai.app
rm -rf ~/Library/Preferences/Parlo.*
rm -rf ~/Library/Preferences/Parlo-nightly.*
rm -rf ~/Library/Caches/Parlo.*
rm -rf ~/Library/Caches/Parlo-nightly.*
rm -rf ~/Library/Caches/Parlo.ai.app
rm -rf ~/Library/Caches/Parlo-nightly.ai.app
rm -rf ~/Library/WebKit/Parlo.ai.app
rm -rf ~/Library/WebKit/Parlo-nightly.ai.app
rm -rf ~/Library/Saved\ Application\ State/Parlo.ai.app
rm -rf ~/Library/Saved\ Application\ State/Parlo-nightly.ai.app

# Clean up downloaded installer
rm -f "/tmp/Parlo-installer.dmg"
rm -rf "/tmp/Parlo-mount"

echo "Cleanup completed"
