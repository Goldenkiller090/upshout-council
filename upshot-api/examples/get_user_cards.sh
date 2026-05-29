#!/bin/bash
# Get all cards owned by a wallet
# Usage: ./get_user_cards.sh 0x89A8f58daF80b0B7a5419848c114AD272a72F887

WALLET="${1:?Usage: $0 <wallet_address>}"

curl -s "https://api-mainnet.upshotcards.net/api/v1/cards/balances/$WALLET" | \
  jq -r '.data | to_entries[] | select(.value.unclaimedQuantity != "0" or .value.claimedQuantity != "0") | "\(.value.card.name): \(.value.unclaimedQuantity) unclaimed, \(.value.claimedQuantity) claimed"'
