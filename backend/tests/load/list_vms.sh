#!/bin/bash

# Load Test Script: List VMs
# Usage: ./list_vms.sh [requests] [concurrency]

REQUESTS=${1:-1000}
CONCURRENCY=${2:-50}
API_URL=${API_URL:-http://localhost:8080}
TOKEN=${TOKEN:-""}

echo "============================================"
echo "LimiQuantix Load Test: ListVMs"
echo "============================================"
echo "URL: $API_URL"
echo "Requests: $REQUESTS"
echo "Concurrency: $CONCURRENCY"
echo "============================================"

# Check if hey is installed
if ! command -v hey &> /dev/null; then
    echo "Error: 'hey' is not installed."
    echo "Install with: go install github.com/rakyll/hey@latest"
    exit 1
fi

# Get token if not provided
if [ -z "$TOKEN" ]; then
    echo "Getting auth token..."
    RESPONSE=$(curl -s -X POST "$API_URL/limiquantix.auth.v1.AuthService/Login" \
        -H "Content-Type: application/json" \
        -d '{"username": "admin", "password": "admin"}')
    
    TOKEN=$(echo $RESPONSE | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
    
    if [ -z "$TOKEN" ]; then
        echo "Error: Failed to get token"
        exit 1
    fi
    echo "Token obtained."
fi

echo ""
echo "Starting load test..."
echo ""

hey -n $REQUESTS -c $CONCURRENCY \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -m POST \
    -d '{"page_size": 10}' \
    "$API_URL/limiquantix.compute.v1.VMService/ListVMs"

echo ""
echo "Load test complete."
