#!/bin/bash
# Ubuntu cleanup script for Parlo app

echo "Cleaning existing Parlo installations..."

# Remove Parlo data folders (both regular and nightly)
rm -rf ~/.config/Parlo
rm -rf ~/.config/Parlo-nightly
rm -rf ~/.local/share/Parlo
rm -rf ~/.local/share/Parlo-nightly
rm -rf ~/.cache/Parlo
rm -rf ~/.cache/Parlo-nightly
rm -rf ~/.local/share/Parlo-nightly.ai.app
rm -rf ~/.local/share/Parlo.ai.app

# Kill any running Parlo processes (both regular and nightly)
pkill -f "Parlo" || true
pkill -f "Parlo" || true
pkill -f "Parlo-nightly" || true
pkill -f "Parlo-nightly" || true

echo "Parlo cleanup completed"
