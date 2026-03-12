# RasoiLink Match Engine

A TypeScript microservice that scores worker × listing compatibility across 9 dimensions.

---

## Quick Start

```bash
cp .env.example .env
# edit .env with your DATABASE_URL

npm install
npm run dev       # development (ts-node-dev, hot reload)
npm run build     # compile TypeScript → dist/
npm start         # run compiled output
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/score/:worker_id/:listing_id` | Score one pair (cached, 15-min TTL) |
| POST | `/matches/worker` | Get top job matches for a worker |
| POST | `/matches/listing` | Get top candidates for a listing |
| POST | `/cache/warm/worker` | Warm cache after profile update |
| POST | `/cache/warm/listing` | Warm cache when listing goes active |
| POST | `/recompute` | Full recompute (admin, requires `x-internal-secret`) |
| POST | `/maintenance` | Clean expired cache entries |

### Example: Worker Match Feed
```http
POST /matches/worker
Content-Type: application/json

{
  "worker_id": "usr_01WORKER_RAJESH_00000001",
  "min_score": 60,
  "limit": 10,
  "accommodation_only": true
}
```

### Example: Listing Candidates
```http
POST /matches/listing
Content-Type: application/json

{
  "listing_id": "lst_01SPICE_ROUTE_TANDOOR_001",
  "min_score": 70,
  "verified_only": true,
  "sort": "score_desc"
}
```

---

## Scoring Dimensions

| Dimension | Max | Description |
|-----------|-----|-------------|
| Location | 20 | Same state = 20, preferred state = 15, willing to relocate = 8 |
| Pay | 18 | Pay range overlap / proximity |
| Cuisine | 15 | % of required cuisines covered, +2 bonus for full coverage |
| Accommodation | 12 | Mutual need/provision alignment |
| Hours | 10 | Listing hours vs role-typical expectations |
| Trust | 8 | Worker trust score + owner pay reliability |
| Experience | 7 | Worker years vs listing requirement |
| Language | 4 | Language match + family group proximity |
| Notice | 3 | Notice period compatibility |

**Total: 97 possible points, normalized to 0–100.**
Matches below 50 are hidden from both parties.

## Hard Gates (block match entirely)
- Worker already has active agreement
- Worker has open pay dispute
- Worker trust score < 2.0 (and has existing ratings)
- Worker profile completeness < 40%
- Owner business not verified

---

## Running Tests

```bash
npm test              # run all tests with coverage
npm run test:watch    # watch mode
```

35 tests covering all 9 dimension scorers, hard gates, and end-to-end scenarios.
