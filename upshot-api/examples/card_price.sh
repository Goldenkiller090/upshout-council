#!/bin/bash
# Get buy/sell price for a specific card
# Usage: ./card_price.sh <card_id>

CARD_ID="${1:?Usage: $0 <card_id>}"

curl -s "https://api-mainnet.upshotcards.net/api/v1/shopkeeper/$CARD_ID?quantity=1" | \
  jq '{
    buyPrice: (.data.cardPricing.buyPrice | tonumber / 1000000),
    sellPrice: (.data.cardPricing.sellPrice | tonumber / 1000000),
    available: .data.cardPricing.shopkeeperBalance
  }'
