#!/bin/bash
# List all cards currently for sale on Upshot marketplace

curl -s "https://api-mainnet.upshotcards.net/api/v1/shopkeeper/balances?isTradeable=true&includePricing=true&hideZeroBalances=true" | \
  jq -r '.data | to_entries[] | "\(.key): \(.value.cardPricing.buyPrice | tonumber / 1000000) GOLD (qty: \(.value.cardPricing.shopkeeperBalance))"'
