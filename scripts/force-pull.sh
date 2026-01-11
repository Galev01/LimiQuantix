#!/bin/bash

# Force Pull Script for Quantix-KVM
# This script forcefully resets the local repository to match origin/main
# WARNING: This will discard ALL local uncommitted changes!

set -e  # Exit on error

echo "⚠️  WARNING: This will discard all local uncommitted changes!"
echo "📦 Fetching latest changes from origin..."
git fetch origin

echo "🔄 Resetting to origin/main (discarding local changes)..."
git reset --hard origin/main

echo "🧹 Cleaning untracked files..."
git clean -fd

echo "♻️  Restoring any deleted files from remote..."
git restore .

echo "✅ Force pull complete! Your repository now matches origin/main."
echo ""
echo "Current status:"
git status
