#!/usr/bin/env python3
"""
Check if a wallet owns a specific Upshot card.

Usage:
    python3 check_ownership.py <wallet_or_profile_url> <card_id_or_url>

Examples:
    python3 check_ownership.py 0x89A8f58daF80b0B7a5419848c114AD272a72F887 cmlyvmdds008a2hqifjhrrrds
    python3 check_ownership.py https://upshot.cards/profile/0x89A8... https://upshot.cards/card-detail/cmly...
"""

import sys
import re
import urllib.request
import json

API_BASE = "https://api-mainnet.upshotcards.net/api/v1"

def extract_wallet(input_str: str) -> str:
    """Extract wallet address from URL or return as-is if already an address."""
    # Already a wallet address
    if input_str.startswith("0x") and len(input_str) == 42:
        return input_str
    
    # Extract from profile URL
    match = re.search(r'0x[a-fA-F0-9]{40}', input_str)
    if match:
        return match.group(0)
    
    raise ValueError(f"Could not extract wallet from: {input_str}")

def extract_card_id(input_str: str) -> str:
    """Extract card ID from URL or return as-is."""
    # Already a card ID (starts with cm, ~25 chars)
    if input_str.startswith("cm") and len(input_str) > 20:
        return input_str
    
    # Extract from card-detail URL
    match = re.search(r'card-detail/([a-z0-9]+)', input_str)
    if match:
        return match.group(1)
    
    raise ValueError(f"Could not extract card ID from: {input_str}")

def check_ownership(wallet: str, card_id: str) -> dict:
    """Check if wallet owns the card. Returns card data or None."""
    url = f"{API_BASE}/cards/balances/{wallet}?cardId={card_id}"
    
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode())
    
    if card_id in data.get("data", {}):
        return data["data"][card_id]
    return None

def get_card_info(card_id: str) -> dict:
    """Get card name and details."""
    url = f"{API_BASE}/cards/{card_id}"
    
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode())
    
    return data.get("data", {})

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    
    try:
        wallet = extract_wallet(sys.argv[1])
        card_id = extract_card_id(sys.argv[2])
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)
    
    print(f"Wallet: {wallet}")
    print(f"Card ID: {card_id}")
    print()
    
    # Get card info
    card_info = get_card_info(card_id)
    card_name = card_info.get("name") or card_info.get("title", "Unknown")
    print(f"Card: {card_name}")
    print()
    
    # Check ownership
    ownership = check_ownership(wallet, card_id)
    
    if ownership:
        # API returns strings, convert to int
        claimed = int(ownership.get("claimedQuantity") or 0)
        unclaimed = int(ownership.get("unclaimedQuantity") or 0)
        total = claimed + unclaimed
        winning = ownership.get("winning", False)
        
        if total > 0:
            print(f"✅ OWNS: {total} card(s)")
            print(f"   Claimed: {claimed}, Unclaimed: {unclaimed}")
            if winning:
                print(f"   🏆 WINNING CARD")
        else:
            print("❌ Does NOT own this card")
    else:
        print("❌ Does NOT own this card")

if __name__ == "__main__":
    main()
