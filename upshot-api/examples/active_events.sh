#!/bin/bash
# List all active prediction events

curl -s "https://api-mainnet.upshotcards.net/api/v1/events?status=ACTIVE&kind=SKILL" | \
  jq -r '.data[] | "\(.name) — resolves \(.eventDate)"'
