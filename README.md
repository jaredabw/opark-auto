# opark-auto

Automatically renews a daily OPark parking session at 5:00am Melbourne time. A small Express server runs on a VPS; you trigger it from your phone after parking.

## How it works

1. You park and hit `/schedule` from an iPhone Shortcut.
2. The server sets a timer for the next 5:00am AEST (with a small random jitter).
3. At 5am, `renew.js` launches headless Chromium, logs into `portal.opark.com.au`, and starts a new parking session.
4. Optionally sends a push notification via [ntfy.sh](https://ntfy.sh) on success or failure.

## Setup

### `.opark-credentials`

```
OPARK_USERNAME=your@email.com
OPARK_PASSWORD=yourpassword
OPARK_VEHICLE=yourplate
OPARK_LOCATION=Your Location Name
OPARK_ZONE=Your Zone Name
OPARK_SCHEDULER_TOKEN=some-long-random-string
OPARK_NTFY_TOPIC=your-private-ntfy-topic   # optional
```

### Install & run

```bash
npm install
npx playwright install chromium
node server.js
```

For production, run with pm2:

```bash
pm2 start server.js --name opark-scheduler
pm2 save && pm2 startup
```

## API endpoints

All endpoints require the header `x-auth-token: <OPARK_SCHEDULER_TOKEN>`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/schedule` | Schedule the next 5am renewal |
| `GET` | `/status` | Check what's currently scheduled |
| `POST` | `/run-now` | Trigger renewal immediately (testing) |
| `POST` | `/cancel` | Cancel a pending scheduled run |

`/schedule` and `/run-now` accept an optional `x-opark-zone` header.
Omit it to use `OPARK_ZONE` from the environment. No request body is needed.
The zone can be a unique substring of the displayed zone name; use the full name
if a shorter substring matches multiple zones. Empty values return HTTP 400.
A scheduled run keeps the zone selected when the request was made.
The `/schedule` response includes `zone` alongside `status` and `for`.
`for` and `/status`'s `scheduledFor` use Melbourne time in `HH:mm dd-MM-yy` format,
for example `05:02 13-11-26`.
`/status` returns `scheduledFor` and `zone`; both are `null` when no run is pending.
The returned zone is the supplied substring or the `OPARK_ZONE` default.

```bash
curl -X POST http://localhost:3000/schedule \
  -H "x-auth-token: YOUR_TOKEN" \
  -H "x-opark-zone: Caulfield - Multi-Level - Blue"
```

## iPhone Shortcut

Use **Get Contents of URL** with:
- URL: `https://opark.yourdomain.com/schedule`
- Method: `POST`
- Headers: `x-auth-token` → your token
- Optional header: `x-opark-zone` → your zone name or unique substring

Add **Get Dictionary from Input** → **Get Dictionary Value** for `for` to see the scheduled time. Run the shortcut after you park each day.

## Logs

- `scheduler.log` — server scheduling events
- `renew.log` — per-run browser automation output
- `last-failure.png` — screenshot saved on any failure
