#!/usr/bin/env bash
set -e

PORT=3099
echo "=== Starting Cynbit Remediation Service on port $PORT ==="
PORT=$PORT node dist/index.js &
SERVER_PID=$!

# Ensure server process is killed on exit
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

# Wait for server to become responsive
sleep 1.5

echo ""
echo "=== Test 1: Health Probe & Security Headers Inspection ==="
curl -i -s http://127.0.0.1:$PORT/health

echo ""
echo "=== Test 2: Valid Inquiry Submission (Expect 201 Created) ==="
curl -i -s -X POST http://127.0.0.1:$PORT/api/inquiry \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Dev Dhanadiya",
    "email": "dev@example.com",
    "phone": "+918947962667",
    "subject": "TECHNICAL_CONSULTING",
    "message": "Inquiry regarding backend distributed architecture and microservices security audit."
  }'

echo ""
echo "=== Test 3: Unknown Key Injection / Strict Schema Rejection (Expect 422 RFC 7807) ==="
curl -i -s -X POST http://127.0.0.1:$PORT/api/inquiry \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Malicious Actor",
    "email": "attacker@exploit.net",
    "subject": "GENERAL_INQUIRY",
    "message": "Testing injection of unauthorized administrative role parameter.",
    "role": "admin",
    "isSuperuser": true
  }'

echo ""
echo "=== Test 4: Rate Limiting Exhaustion (Burst 5 Requests, Expect 429) ==="
for i in {1..5}; do
  echo "--- Burst Request $i ---"
  curl -s -o /dev/null -w "Status: %{http_code} | Remaining: %{header{x-ratelimit-remaining}}\n" \
    -X POST http://127.0.0.1:$PORT/api/inquiry \
    -H "Content-Type: application/json" \
    -d '{
      "fullName": "Dev Dhanadiya",
      "email": "dev@example.com",
      "subject": "GENERAL_INQUIRY",
      "message": "Evaluating rate limiter token replenishment and exhaustion."
    }'
done

echo "--- Request 6 (Depleted Bucket: Expect 429 with Retry-After) ---"
curl -i -s -X POST http://127.0.0.1:$PORT/api/inquiry \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Dev Dhanadiya",
    "email": "dev@example.com",
    "subject": "GENERAL_INQUIRY",
    "message": "Evaluating rate limiter token replenishment and exhaustion."
  }'

echo ""
echo "=== Test 5: Unhandled Exception Masking (Expect 500 RFC 7807 with Incident ID) ==="
curl -i -s http://127.0.0.1:$PORT/api/simulate-fault

echo ""
echo "=== All Tests Executed Successfully ==="
