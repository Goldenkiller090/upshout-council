# Upshot Cards API

Unofficial API documentation and tools for [Upshot Cards](https://upshot.cards) — a prediction market platform where you collect cards representing outcomes and win prizes when your predictions hit.

## Base URL

```
https://api-mainnet.upshotcards.net/api/v1
```

> ⚠️ **April 2026:** API is now behind **Bunny Shield** anti-bot protection. Direct requests from flagged IPs receive HTML challenge pages. See [BUNNY_SHIELD.md](BUNNY_SHIELD.md) for workarounds.

---

## Table of Contents

- [Authentication](#authentication)
- [Endpoints](#endpoints)
  - [Cards](#cards)
  - [Events](#events)
  - [Marketplace (Shopkeeper)](#marketplace-shopkeeper)
  - [Users](#users)
  - [Wallet](#wallet)
  - [Contests](#contests)
  - [Lineups](#lineups)
  - [Categories](#categories)
  - [Packs](#packs)
- [Data Formats](#data-formats)
- [Pagination](#pagination)
- [Rate Limits](#rate-limits)
- [Tools](#tools)
- [Examples](#examples)

---

## Core Concepts

### Cards
Prediction cards represent specific outcomes. Each card has:
- **name** — The prediction (e.g., "ETH Closes Above $4000")
- **rarity** — COMMON, UNCOMMON, RARE, LEGENDARY
- **maxSupply** — Total cards that can exist
- **pointsValue** — Points earned if prediction wins
- **event** — The parent event this card belongs to

### Events
Events are prediction markets with multiple possible outcomes (cards):
- **ACTIVE** — Ongoing, cards tradeable
- **RESOLVED** — Outcome determined, winning cards identified
- **kind** — SKILL (prediction), CASH (monetary), INSTANT

### Currencies
- **GOLD** — Primary currency
- **SHOT** — Original token
- **CASH** — USD-pegged

All prices in **micro-units** (6 decimals):
```
46620000 = 46.62 GOLD
1890000 = 1.89 GOLD
```

### Wallets
Users identified by Ethereum wallet addresses (0x...). Profile URLs contain the wallet:
```
https://upshot.cards/profile/0x89A8f58daF80b0B7a5419848c114AD272a72F887
```

---

## Authentication

### Overview

- **Read endpoints:** No authentication required
- **Write endpoints:** Require JWT token in Authorization header

### Token Type (CRITICAL)

**The working token is NOT `privy:token` from localStorage!**

The app uses an internal HS256 JWT with this payload:
```json
{
  "sub": "cmkf01zdb0g4k2hlwi73kcrpq",
  "walletAddress": "0x89A8f58daF80b0B7a5419848c114AD272a72F887",
  "id": "cmkf01zdb0g4k2hlwi73kcrpq",
  "role": "USER",
  "iat": 1774854657,
  "exp": 1774908657
}
```

**Key differences from Privy token:**
- `sub` is user ID (not `did:privy:...`)
- Contains `walletAddress` directly
- ~15 hour validity (not 24h)

### Header Format

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Token Extraction

The token appears in Authorization headers on authenticated requests. Extract via CDP network interception:

```python
import json
import base64
import websocket
import requests

def get_api_token(cdp_port=9224):
    # Get upshot.cards tab
    tabs = requests.get(f"http://localhost:{cdp_port}/json").json()
    ws_url = next(t["webSocketDebuggerUrl"] for t in tabs 
                  if "upshot.cards" in t.get("url", ""))
    
    ws = websocket.create_connection(ws_url, timeout=30)
    
    # Enable network monitoring
    ws.send(json.dumps({"id": 1, "method": "Network.enable"}))
    ws.recv()
    
    # Navigate to trigger auth request
    ws.send(json.dumps({
        "id": 2,
        "method": "Page.navigate",
        "params": {"url": "https://upshot.cards/dashboard"}
    }))
    
    # Listen for Authorization header with HS256 token
    import time
    start = time.time()
    while time.time() - start < 15:
        try:
            ws.settimeout(1)
            msg = json.loads(ws.recv())
            if msg.get("method") == "Network.requestWillBeSent":
                headers = msg.get("params", {}).get("request", {}).get("headers", {})
                auth = headers.get("Authorization", "")
                if "Bearer " in auth:
                    token = auth.replace("Bearer ", "")
                    # Verify it's the API token (has walletAddress)
                    payload = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
                    if "walletAddress" in payload:
                        ws.close()
                        return token
        except:
            pass
    
    ws.close()
    return None
```

**Important:** Navigate to `/dashboard` or any authenticated page to trigger API requests.

### Privy Auth Flow (Reference)

The app uses Privy for initial wallet auth:
```
POST https://auth.privy.io/api/v1/sessions
Headers:
  privy-app-id: cmg9qbu8c00bdib0bur8e9yxx
  privy-client: react-auth:3.12.0
  privy-client-id: client-WY6RRYwVosWK5JwkkDGzoScDexBXCdNUPzZosEK6eJhji
Body: { "refresh_token": "..." }
```

But the internal API uses its own JWT, not Privy tokens directly.

---

## Endpoints

### Cards

#### Search Cards
```
GET /cards?search={query}
```
Search cards by name.

#### Get Cards by Event
```
GET /cards?eventId={eventId}&include=event,supply
```
List all cards for a specific event.

#### Get Card Details
```
GET /cards/{cardId}
GET /cards/{cardId}?include=event,supply
```

**Response:**
```json
{
  "data": {
    "id": "cmlyvmdds008a2hqifjhrrrds",
    "name": "Project Hail Mary Scores 8.0-8.9 on IMDb",
    "rarity": "RARE",
    "maxSupply": 334,
    "pointsValue": "86000000",
    "prizeAmount": "0",
    "prizeType": "GOLD",
    "image": "GHAh0GIYBHCzvLxUI2UFEOHEuF9-3HTwVgVdWbqSBdQ",
    "outcomeId": "...",
    "event": {
      "id": "...",
      "status": "ACTIVE",
      "winningOutcomeId": null
    }
  }
}
```

#### Get User's Cards
```
GET /cards/balances/{walletAddress}
GET /cards/balances/{walletAddress}?include=card
```
List all cards owned by a wallet.

#### Check Specific Card Ownership
```
GET /cards/balances/{walletAddress}?cardId={cardId}
```

**Response:**
```json
{
  "data": {
    "cmn2sddn17y662iooxs9u978i": {
      "winning": false,
      "claimedQuantity": "0",
      "unclaimedQuantity": "3",
      "card": { ... }
    }
  }
}
```

- `claimedQuantity` — Cards claimed (finalized)
- `unclaimedQuantity` — Cards owned but not yet claimed
- `winning` — True if this card won its event

#### Get Eligible Cards for Contest 🔒
```
GET /cards/eligible-for-contest/{contestId}
GET /cards/eligible-for-contest/{contestId}?page=1&perPage=100
```

Returns cards you own that can be used in a specific contest.

**Response:**
```json
{
  "data": {
    "cmncpfuh9ixnu2ht3aiwym5ci": {
      "card": {
        "id": "cmncpfuh9ixnu2ht3aiwym5ci",
        "name": "3 Cards in Man City vs Liverpool FA Cup QF",
        "pointsValue": "100000000",
        "rarity": "RARE",
        "maxSupply": 334,
        "outcome": {
          "id": "...",
          "name": "3 Cards",
          "event": {
            "id": "...",
            "name": "FA Cup QF: Man City vs Liverpool",
            "status": "ACTIVE"
          }
        }
      },
      "unclaimedQuantity": "2",
      "claimedQuantity": "1"
    }
  },
  "meta": { "total": 27 }
}
```

**Key fields:**
- `pointsValue` — divide by 1,000,000 for display (100000000 = 100 pts)
- `unclaimedQuantity` — copies available for lineups
- `claimedQuantity` — copies already locked in lineups

#### Determine Win/Loss Status

**Method 1: Check `winning` field in balance response**
```bash
curl -s ".../cards/balances/{wallet}?include=card"
```
- `winning: true` → card won
- `winning: false` + `event.status == "RESOLVED"` → card lost  
- `winning: false` + `event.status == "ACTIVE"` → not resolved yet

**Method 2: Compare outcomeId vs winningOutcomeId**
```bash
curl -s ".../cards/{cardId}" | jq '{
  name: .data.name,
  outcomeId: .data.outcomeId,
  eventStatus: .data.event.status,
  winningOutcomeId: .data.event.winningOutcomeId,
  won: (.data.outcomeId == .data.event.winningOutcomeId)
}'
```

---

### Events

#### List Events
```
GET /events
GET /events?status=ACTIVE
GET /events?status=RESOLVED
GET /events?kind=SKILL
```

#### Get Event Details
```
GET /events/{eventId}
```

**Response:**
```json
{
  "data": {
    "id": "cmlyvmdbz007w2hqig8r3sday",
    "name": "Project Hail Mary IMDb Rating",
    "status": "ACTIVE",
    "kind": "SKILL",
    "eventDate": "2026-03-27T00:00:00.000Z",
    "pricePerCard": "1890000",
    "winningOutcomeId": null,
    "resolvedAt": null
  }
}
```

---

### Marketplace (Shopkeeper)

The "shopkeeper" is Upshot's marketplace where users buy/sell cards.

#### List All Marketplace Listings
```
GET /shopkeeper/balances
GET /shopkeeper/balances?isTradeable=true&includePricing=true&hideZeroBalances=true
```

**Response:**
```json
{
  "data": {
    "cardId123": {
      "cardPricing": {
        "shopkeeperBalance": 1,
        "buyPrice": "5910000",
        "sellPrice": "5000000",
        "buyCommission": "591000",
        "sellCommission": "500000"
      }
    }
  }
}
```

- `shopkeeperBalance` — Quantity available to buy
- `buyPrice` — Price to buy (in micro-units)
- `sellPrice` — Price you'd get selling

#### Get Quote for Specific Card
```
GET /shopkeeper/{cardId}?quantity=1
```

**Response:**
```json
{
  "data": {
    "cardId": "...",
    "currency": "GOLD",
    "buyPrice": "46620000",
    "sellPrice": "42180000",
    "buyCommission": "2220000",
    "sellCommission": "2220000",
    "shopkeeperBalance": "0",
    "isTradeable": true
  }
}
```

#### Buy Card 🔒
```
POST /shopkeeper/buy
Content-Type: application/json
Authorization: Bearer <token>

{
  "cardId": "cmmet3qtd23pu2hr2arhzvyck",
  "quantity": 1
}
```

**Success:** Returns transaction details
**Error 401:** Invalid/expired token
**Error 400:** Insufficient balance or card unavailable

---

### Users

#### Get User Profile
```
GET /users/{walletAddress}
```

**Response:**
```json
{
  "data": {
    "id": "user123",
    "address": "0x89A8f58daF80b0B7a5419848c114AD272a72F887",
    "username": "hazy",
    "displayName": "Hazy",
    "avatarUrl": "...",
    "bio": "...",
    "referralCode": "414f078c",
    "referralBalance": 3549253,
    "freeClaimActive": true,
    "createdAt": "2026-01-15T...",
    "lastLoginAt": "2026-03-23T..."
  }
}
```

Note: `referralBalance` is referral **count**, not earnings.

#### Get Current User 🔒
```
GET /users/me
```

Returns the authenticated user's profile.

---

### Wallet 🔒

#### Get Wallet Balance
```
GET /wallet
Authorization: Bearer <token>
```

Returns GOLD, SHOT, and CASH balances.

#### Get Transactions
```
GET /wallet/transactions
Authorization: Bearer <token>
```

Returns transaction history (buys, sells, rewards, etc.).

---

### Contests

#### List Contests
```
GET /contests
GET /contests?status=LIVE
GET /contests?status=UPCOMING
GET /contests?status=ENDED
```

**Response:**
```json
{
  "data": [
    {
      "id": "cmnd8hifepjf22hq5fw67b11o",
      "name": "Pick 3: Early April Sports",
      "status": "LIVE",
      "prizePool": "290770000",
      "lineupSize": 3,
      "maxLineups": null,
      "entryClosesAt": "2026-04-03T01:25:00.000Z",
      "resolvesAt": "2026-04-06T13:45:00.000Z"
    }
  ],
  "meta": { "total": 5, "currentPage": 1, "perPage": 20 }
}
```

#### Get Contest Details
```
GET /contests/{contestId}
```

**Response:**
```json
{
  "data": {
    "id": "...",
    "name": "Pick 3: Early April Sports",
    "description": "...",
    "status": "LIVE",
    "prizePool": "290770000",
    "lineupSize": 3,
    "lineupCount": 85,
    "entryClosesAt": "2026-04-03T01:25:00.000Z"
  }
}
```

#### Get Contest Standings
```
GET /contests/{contestId}/standings
GET /contests/{contestId}/standings?page=1&perPage=10
```

Returns leaderboard with user rankings and scores.

#### Get Suggested Lineup
```
GET /contests/{contestId}/suggested-lineup
```

Auto-builds optimal lineup based on point values (not EV).

---

### Lineups 🔒

#### Get My Lineups
```
GET /contests/lineups/me?contestId={contestId}
GET /contests/lineups/me?contestId={contestId}&perPage=50
Authorization: Bearer <token>
```

**Response:**
```json
{
  "data": [
    {
      "id": "cmndd5slhr9ag2hmhyyomh5r4",
      "contestId": "cmnd8hifepjf22hq5fw67b11o",
      "cardIds": ["cardId1", "cardId2", "cardId3"],
      "currentScore": "0",
      "maxPossibleScore": "467000000",
      "resolvedCards": "0",
      "status": "ACTIVE",
      "createdAt": "2026-03-30T15:49:29.477Z"
    }
  ],
  "meta": { "total": 3 }
}
```

#### Submit Lineup
```
POST /contests/{contestId}/lineups
Content-Type: application/json
Authorization: Bearer <token>

{
  "contestId": "cmnd8hifepjf22hq5fw67b11o",
  "cardIds": ["cardId1", "cardId2", "cardId3"],
  "status": "ACTIVE"
}
```

**Required fields:**
- `contestId` (string) — must match URL parameter
- `cardIds` (array) — length must equal contest's `lineupSize`
- `status` (string) — "ACTIVE" or "DRAFT"

**Success response:**
```json
{
  "data": {
    "id": "cmndd5slhr9ag2hmhyyomh5r4",
    "contestId": "cmnd8hifepjf22hq5fw67b11o",
    "cardIds": ["cardId1", "cardId2", "cardId3"],
    "maxPossibleScore": "467000000",
    "status": "ACTIVE",
    "createdAt": "2026-03-30T15:49:29.477Z"
  }
}
```

**Error responses:**
```json
// Missing fields
{
  "message": ["contestId should not be empty", "status should not be empty"],
  "error": "Bad Request",
  "statusCode": 400
}

// Card not owned or already used
{
  "message": "Invalid lineup: You don't own card: Chelsea Beat Port Vale",
  "error": "Bad Request",
  "statusCode": 400
}

// Bad token
{
  "message": "Unauthorized",
  "statusCode": 401
}
```

---

### Categories

#### List Categories
```
GET /categories
```

Returns event categories: Entertainment, Gaming, Sports, Crypto, Finance, Politics, Culture.

---

### Packs

#### List Packs
```
GET /packs
```

Mystery pack offerings with card bundles.

---

## Data Formats

### Price Conversion
```python
# API returns micro-units (6 decimals)
raw_price = 46620000
display_price = raw_price / 1_000_000  # 46.62 GOLD
```

### Points Conversion
```python
# Same format as prices
raw_points = 100000000
display_points = raw_points / 1_000_000  # 100 points
```

### Card ID Format
Card IDs are ~25 character strings starting with "cm":
```
cmlyvmdds008a2hqifjhrrrds
cmn2sddn17y662iooxs9u978i
```

### Wallet Address Format
Standard Ethereum addresses:
```
0x89A8f58daF80b0B7a5419848c114AD272a72F887
```

### Image URLs
Card images are stored on **Arweave** (permanent decentralized storage). The `image` field is an Arweave transaction ID.

```
https://arweave.net/{image}
```

**Example:**
```python
card = api.get("/cards/cmm0d4dud001d2iqmjv7lhzsc")
image_url = f"https://arweave.net/{card['image']}"
# https://arweave.net/WoXNh1akkbfa_8j0nU5K4UE-hO3PtEw-cCJNi2TdIGk
```

The Upshot frontend uses Next.js image optimization:
```
https://upshot.cards/_next/image?url=https://arweave.net/{image}&w=640&q=75
```

---

## Pagination

All list endpoints support:
```
?page=1&perPage=20
?limit=50
```

**Response meta:**
```json
{
  "meta": {
    "total": 150,
    "lastPage": 8,
    "currentPage": 1,
    "perPage": 20,
    "prev": null,
    "next": 2
  }
}
```

---

## Rate Limits

No documented limits. Observed behavior:
- No immediate throttling on moderate use
- Recommended: 1 request/second for batch operations
- If 429 received, respect `Retry-After` header

---

## Tools

### check_ownership.py

Check if a wallet owns a specific card.

```bash
# With full URLs
python3 check_ownership.py https://upshot.cards/profile/0x89A8... https://upshot.cards/card-detail/cmn2...

# With just IDs
python3 check_ownership.py 0x89A8f58daF80b0B7a5419848c114AD272a72F887 cmn2sddn17y662iooxs9u978i
```

**Output:**
```
Wallet: 0x89A8f58daF80b0B7a5419848c114AD272a72F887
Card ID: cmn2sddn17y662iooxs9u978i

Card: Death Stranding 2 Peaks Between 50,000 - 79,999 on Steam

✅ OWNS: 3 card(s)
   Claimed: 0, Unclaimed: 3
```

---

## Examples

### Check remaining cards after lineup submission
```bash
curl -s ".../cards/eligible-for-contest/${CONTEST_ID}?perPage=100" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '[.data | to_entries[] | select(.value.unclaimedQuantity | tonumber > 0) | {
    id: .key,
    name: .value.card.name,
    points: (.value.card.pointsValue | tonumber / 1000000),
    qty: .value.unclaimedQuantity
  }] | sort_by(-.points)'
```

### Verify lineup count
```bash
curl -s ".../contests/lineups/me?contestId=${CONTEST_ID}" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.data | length'
```

### Submit lineup and verify
```bash
# Submit
RESULT=$(curl -s -X POST ".../contests/${CONTEST_ID}/lineups" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"contestId":"'"$CONTEST_ID"'","cardIds":["id1","id2","id3"],"status":"ACTIVE"}')

# Check success
echo "$RESULT" | jq '{id: .data.id, points: (.data.maxPossibleScore | tonumber / 1000000), error: .message}'
```

### Check all marketplace listings
```bash
curl -s ".../shopkeeper/balances?isTradeable=true&includePricing=true&hideZeroBalances=true" \
  | jq '.data | keys | length'
```

### Get cards for an event
```bash
curl -s ".../cards?eventId=cmlyvmdbz007w2hqig8r3sday&include=event" \
  | jq '.data[] | {name, rarity, maxSupply}'
```

### Check if someone owns a card
```bash
curl -s ".../cards/balances/0x89A8...?cardId=cmn2sddn..." \
  | jq '.data[].unclaimedQuantity'
```

### Find active prediction events
```bash
curl -s ".../events?status=ACTIVE&kind=SKILL" \
  | jq '.data[] | {name, eventDate}'
```

---

## Limitations

1. **No username lookup** — API requires wallet addresses, not usernames
2. **Buy/sell requires auth** — Transactions need valid JWT token
3. **Quantity fields unreliable** — Some owned cards show 0 in certain endpoints
4. **Rate limits** — Undocumented, but 1 req/sec seems safe
5. **Bunny Shield** — Direct API access may be blocked (see [BUNNY_SHIELD.md](BUNNY_SHIELD.md))

---

## License

MIT — Use at your own risk. This is unofficial documentation.

---

*Last updated: 2026-04-03*
