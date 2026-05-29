# Bunny Shield Protection (April 2026)

## Overview

As of early April 2026, **Upshot's API is behind Bunny Shield** anti-bot protection. Direct API calls from flagged IPs receive an HTML challenge page instead of JSON.

## Detection

**Symptom:** API returns 200 status but `Content-Type: text/html`:

```bash
curl -s "https://api-mainnet.upshotcards.net/api/v1/contests" | head -5
```

```html
<!DOCTYPE html>
<html>
<head>
    <title>Establishing a secure connection ...</title>
    ...
    <script src="/.bunny-shield/assets/shield-challenge.js"></script>
```

**Headers:**
```
HTTP/2 200 
content-type: text/html
server: BunnyCDN-JP1-1185
cdn-pullzone: 5344147
set-cookie: bunny_shield=; expires=...
set-cookie: bunny_shield_chk=; expires=...
```

## Affected Endpoints

**ALL endpoints on `api-mainnet.upshotcards.net` are affected:**

| Endpoint | Direct Call | Via Browser |
|----------|-------------|-------------|
| `GET /contests` | ❌ HTML challenge | ✅ Works |
| `GET /cards/{id}` | ❌ HTML challenge | ✅ Works |
| `GET /shopkeeper/{id}` | ❌ HTML challenge | ✅ Works |
| `POST /shopkeeper/buy` | ❌ HTML challenge | ✅ Works |
| `GET /users/{wallet}` | ❌ HTML challenge | ✅ Works |
| `GET /cards/balances/{wallet}` | ❌ HTML challenge | ✅ Works |
| `GET /events` | ❌ HTML challenge | ✅ Works |

## IP-Based Flagging

Bunny Shield flags IPs, not requests:

- **Clean IP:** API works normally (confirmed on separate machines)
- **Flagged IP:** All requests get challenge page

IPs get flagged from:
- High request volume (polling)
- Bot-like patterns
- Previous challenge failures

## Workarounds

### 1. CDP Browser Proxy (Recommended)

Route API calls through Chrome using DevTools Protocol:

```python
import json
import websocket
import requests

def fetch_via_cdp(endpoint):
    # Get WebSocket URL for browser tab
    tabs = requests.get("http://localhost:9224/json").json()
    ws_url = next(t["webSocketDebuggerUrl"] for t in tabs 
                  if "upshot.cards" in t.get("url", ""))
    
    ws = websocket.create_connection(ws_url, timeout=15)
    ws.send(json.dumps({
        "id": 1,
        "method": "Runtime.evaluate",
        "params": {
            "expression": f"fetch('{endpoint}').then(r=>r.json())",
            "awaitPromise": True,
            "returnByValue": True
        }
    }))
    
    result = json.loads(ws.recv())
    ws.close()
    return result["result"]["result"]["value"]

# Example
data = fetch_via_cdp("https://api-mainnet.upshotcards.net/api/v1/contests")
```

**Requirements:**
- Chrome running with `--remote-debugging-port=9224`
- An upshot.cards tab open (browser is authenticated)

**Pros:** Bypasses Bunny Shield completely
**Cons:** ~1s overhead per request

### 2. Cookie Extraction (Untested)

Could potentially extract `bunny_shield` cookies after browser solves challenge:

```python
# Extract cookies from browser
cookies = driver.get_cookies()
bunny_cookies = {c['name']: c['value'] for c in cookies 
                 if 'bunny' in c['name']}

# Use in direct requests
requests.get(url, cookies=bunny_cookies)
```

**Unknown:** Cookie validity period, whether they're IP-bound

### 3. Clean IP

Run from a non-flagged IP:
- Different machine
- VPN
- Proxy service

## Detection Script

```bash
#!/bin/bash
# Check if IP is flagged by Bunny Shield

RESPONSE=$(curl -s "https://api-mainnet.upshotcards.net/api/v1/contests" \
  -w "\n%{content_type}" | tail -1)

if [[ "$RESPONSE" == *"text/html"* ]]; then
  echo "❌ IP FLAGGED - Bunny Shield active"
else
  echo "✅ IP clean - API accessible"
fi
```

## Timeline

- **Before April 2026:** API fully accessible
- **Early April 2026:** Bunny Shield protection added
- **Ongoing:** Protection persists, IP-based flagging confirmed

## Notes

- Bunny Shield is a BunnyCDN feature, not Upshot-specific
- Challenge requires JavaScript execution (can't solve with curl)
- Browser sessions bypass protection because they complete the challenge
- Protection may be temporary or could become permanent

---

*Last updated: 2026-04-03*
