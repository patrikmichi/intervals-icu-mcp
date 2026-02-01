# Intervals.icu MCP Server

MCP server for [Intervals.icu](https://intervals.icu) - training analytics and workout management platform.

## Features

Access Intervals.icu via MCP tools aligned with the [Intervals.icu API](https://forum.intervals.icu/t/api-access-to-intervals-icu/609):

- **Activities**: Fetch activities (CSV or JSON by date range), get activity by ID with optional intervals
- **Calendars**: List calendars
- **Events**: List events (with optional calendar_id), get/create/update/delete events (create uses `start_date_local` + `moving_time` per API)
- **Workouts**: List library, get/create/update/delete workouts; list folders
- **Wellness**: Get wellness by date or range, update wellness

## Setup

### 1. Get API Key

1. Go to [Intervals.icu](https://intervals.icu)
2. Navigate to Settings → Developer Settings
3. Generate an API key

### 2. Configure Environment

Copy `env.example` to `.env.local`:

```bash
cp env.example .env.local
```

Edit `.env.local` and add your API key:

```
INTERVALS_ICU_API_KEY=your_api_key_here
```

### 3. Install Dependencies

```bash
pnpm install
```

### 4. Run Locally

```bash
pnpm dev
```

Server runs at: `http://localhost:3000`

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

1. Click "Deploy" button
2. Add environment variables:
   - **INTERVALS_ICU_API_KEY** (required) – your Intervals.icu API key
   - **MCP_API_KEY** (optional) – if set, only clients that send this key in headers can use the MCP
3. Deploy
4. Copy deployment URL

## Configure Cursor / MCP

Add to your MCP settings (`mcp.json`):

```json
{
  "mcpServers": {
    "intervals-icu": {
      "url": "https://your-deployment.vercel.app/api/mcp"
    }
  }
}
```

If you set **MCP_API_KEY** in Vercel, clients must send it on every request. Add it under `headers`:

```json
{
  "mcpServers": {
    "intervals-icu": {
      "url": "https://your-deployment.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY"
      }
    }
  }
}
```

Or use the custom header: `"X-MCP-API-Key": "YOUR_MCP_API_KEY"`.

## Webhook (POST events to Intervals.icu)

**Endpoint:** `POST https://your-deployment.vercel.app/api/webhook`

Accepts JSON and creates an event in Intervals.icu. Handles payload issues:

- **Body:** `Content-Type: application/json` with a JSON object, or form-urlencoded with a `payload`/`json`/`body` field containing JSON.
- **Required:** `start_date_local` – date in `yyyy-MM-dd` or `yyyy-MM-ddT00:00:00` (normalized automatically if only date).
- **Optional:** `name`, `description`, `type`, `category`, `moving_time` (seconds), `duration` (mapped to `moving_time`), `indoor`, `calendar_id`, `distance`, `workout_doc` (e.g. `steps` array), `athlete_id` (default `"0"`).
- **Auth:** If `WEBHOOK_SECRET` or `MCP_API_KEY` is set, send `Authorization: Bearer <secret>` or `X-Webhook-Secret: <secret>`.

Example:

```bash
curl -X POST https://your-deployment.vercel.app/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"start_date_local":"2026-02-02","name":"Easy ride","type":"Ride","moving_time":3600}'
```

Response: `{ "ok": true, "action": "create", "event": { ... } }` or `{ "error": "...", "detail": "..." }`.

**Actions: create, update, delete**

- **create** (default) – Omit `action` or send `"action": "create"`. Body: `start_date_local`, optional name, type, category, moving_time, workout_doc, athlete_id.
- **update** – `"action": "update"`, `"event_id": "..."`, plus any fields to change (name, description, start_date_local, moving_time, etc.).
- **delete** – `"action": "delete"`, `"event_id": "..."`, optional `athlete_id`.

Example update: `{"action":"update","event_id":"90347858","name":"Updated title"}`  
Example delete: `{"action":"delete","event_id":"90347858","athlete_id":"0"}`

## Available Tools

| Tool | API | Description |
|------|-----|-------------|
| `ping` | — | Health check; optional test API call. |
| `fetch_activities` | `GET /athlete/{id}/activities.csv` | All activities as CSV. |
| `fetch_activities_list` | `GET /athlete/{id}/activities?oldest=&newest=&type=` | Completed activities (summary) for date range; optional `type` filter (e.g. Run, Ride). Use `get_activity` for full HR/pace/power. |
| `get_activity` | `GET /activity/{id}?intervals=true` | Full activity: heart rate, pace, power, distance, duration; optional per-interval breakdown. |
| `fetch_activities_with_details` | Multiple GETs | Completed activities for date range with full post-workout data (HR, pace, power, intervals). Optional `type` filter. Max 20 per call. |
| `update_activity` | `PUT /activity/{id}` | Update activity (name, type, etc.). |
| `fetch_calendars` | `GET /athlete/{id}/calendars` | List calendars. |
| `fetch_events` | `GET /athlete/{id}/events?oldest=&newest=&calendar_id=` | Events in date range; optional `calendar_id`. |
| `get_event` | `GET /athlete/{id}/events/{eventId}` | Single event. |
| `get_event_completed_activity` | GET event + GET activity | Event plus linked completed-activity data (HR, pace, power) when the workout was done and synced (`paired_activity_id`). |
| `create_event` | `POST /athlete/{id}/events` | Create event (date, name, type, category, `moving_time`). Optional `workout_doc.steps`: **Ride** = `power` (start, end, units "%ftp", target) + `duration`; **Run** = `pace` (start, end, units "%pace") + `distance` and/or `duration`; use `reps` + nested `steps` for intervals. See `event-structure-full.json` (Ride), `event-structure-run-example.json` (Run). |
| `update_event` | `PUT /athlete/{id}/events/{eventId}` | Update event (partial body). |
| `delete_event` | `DELETE /athlete/{id}/events/{eventId}` | Delete event. |
| `download_event` | `GET /athlete/{id}/events/{eventId}/download.{ext}` | Download planned workout as .zwo, .mrc, or .erg (returns base64). |
| `fetch_workouts` | `GET /athlete/{id}/workouts` | List workout library. |
| `get_workout` | `GET /athlete/{id}/workouts/{workoutId}` | Single workout. |
| `create_workout` | `POST /athlete/{id}/workouts` | Create workout (name, description, category, steps). |
| `update_workout` | `PUT /athlete/{id}/workouts/{workoutId}` | Update workout (partial body). |
| `delete_workout` | `DELETE /athlete/{id}/workouts/{workoutId}` | Delete workout. |
| `fetch_folders` | `GET /athlete/{id}/folders` | List folders and their workouts. |
| `create_folder` | `POST /athlete/{id}/folders` | Create folder (name, description, type). |
| `update_folder` | `PUT /athlete/{id}/folders/{folderId}` | Update folder (partial body). |
| `delete_folder` | `DELETE /athlete/{id}/folders/{folderId}` | Delete folder. |
| `get_folder_shared_with` | `GET /athlete/{id}/folders/{folderId}/shared-with` | Who folder is shared with. |
| `update_folder_shared_with` | `PUT /athlete/{id}/folders/{folderId}/shared-with` | Update folder sharing. |
| `fetch_wellness` | `GET /athlete/{id}/wellness` or `.../wellness/{date}` | Wellness by date or range. |
| `update_wellness` | `PUT /athlete/{id}/wellness/{date}` | Update wellness for a date. |
| **Analysis & planning** | | |
| `fetch_training_overview` | Multiple GETs | **Complete analysis:** wellness + completed activities (HR, pace, power, intervals) + planned events for a date range. Use for training load and consistency analysis. |
| `fetch_planning_context` | Multiple GETs | **Planning context:** upcoming events, workout library, recent wellness. Use before creating events to see what is planned and current load. |
| `fetch_power_curves` | `GET /athlete/{id}/power-curves` | Power curves (curves, type, filters, newest). |

## Authentication

- **INTERVALS_ICU_API_KEY** – Set in Vercel (or `.env.local`). Used by the server to call the Intervals.icu API (Basic Auth, username `API_KEY`, password = key). Athlete ID `"0"` is the authenticated user.
- **MCP_API_KEY** – Optional. If set in Vercel, only requests that send this value in `Authorization: Bearer <key>` or `X-MCP-API-Key: <key>` are allowed. Use this so only people who have the key can use your deployed MCP.

## API Documentation

- [Intervals.icu API Docs](https://intervals.icu/api-docs.html)
- [Forum Discussion](https://forum.intervals.icu/t/api-access-to-intervals-icu/609)

## Analysis & planning (complete training workflow)

Use the MCP for **full analysis** and **planning new workouts** in one flow:

### 1. Analyze training (how did the period go?)

- **`fetch_training_overview`** `(oldest, newest)`  
  Returns for that date range:
  - **wellness** – load, resting HR, sleep, stress, etc.
  - **completed_activities** – each with full post-workout data (HR, pace, power, intervals)
  - **planned_events** – what was planned  
  Use this to assess load, consistency, and how workouts matched the plan.

- Optionally **`fetch_power_curves`** for fitness trends (e.g. 90d Ride/Run).

### 2. Plan new workouts (what to do next?)

- **`fetch_planning_context`** `(from_date, span_days?, wellness_days_back?)`  
  Returns:
  - **upcoming_events** – what is already planned (e.g. next 14 days)
  - **workout_library** – templates you can reuse
  - **recent_wellness** – recent load (e.g. last 7 days)  
  Use this before creating events so new workouts fit the plan and load.

- Then **`create_event`** with `workout_doc.steps` (Ride = power + duration, Run = pace + distance/reps) to add planned workouts.

### 3. After a workout is done

- **`get_event_completed_activity`** `(event_id)` – planned event + linked completed activity (HR, pace, power) when synced.
- Or **`fetch_activities_with_details`** `(oldest, newest)` – all completed activities in a range with full metrics.

## License

MIT
