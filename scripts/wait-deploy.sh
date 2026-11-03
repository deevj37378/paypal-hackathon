#!/usr/bin/env bash
# Waits until the newest production deployment of this project is Ready (or Error).
for i in $(seq 1 60); do
  line=$(npx vercel@latest ls allowance < /dev/null 2>&1 | grep -E "https://allowance-" | head -1)
  case "$line" in
    *Ready*) echo "deploy ready: $(echo "$line" | grep -oE 'https://[^ ]+')"; exit 0 ;;
    *Error*|*Canceled*) echo "deploy FAILED: $line"; exit 1 ;;
  esac
  sleep 10
done
echo "timed out waiting for deploy"; exit 1
