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

## Available Tools

| Tool | API | Description |
|------|-----|-------------|
| `ping` | — | Health check; optional test API call. |
| `fetch_activities` | `GET /athlete/{id}/activities.csv` | All activities as CSV. |
| `fetch_activities_list` | `GET /athlete/{id}/activities?oldest=&newest=` | Activities as JSON for date range. |
| `get_activity` | `GET /activity/{id}?intervals=true` | Single activity; optional interval data. |
| `update_activity` | `PUT /activity/{id}` | Update activity (name, type, etc.). |
| `fetch_calendars` | `GET /athlete/{id}/calendars` | List calendars. |
| `fetch_events` | `GET /athlete/{id}/events?oldest=&newest=&calendar_id=` | Events in date range; optional `calendar_id`. |
| `get_event` | `GET /athlete/{id}/events/{eventId}` | Single event. |
| `create_event` | `POST /athlete/{id}/events` | Create event (`start_date_local` with `T00:00:00`, `moving_time` in seconds). |
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
| `fetch_power_curves` | `GET /athlete/{id}/power-curves` | Power curves (curves, type, filters, newest). |

## Authentication

- **INTERVALS_ICU_API_KEY** – Set in Vercel (or `.env.local`). Used by the server to call the Intervals.icu API (Basic Auth, username `API_KEY`, password = key). Athlete ID `"0"` is the authenticated user.
- **MCP_API_KEY** – Optional. If set in Vercel, only requests that send this value in `Authorization: Bearer <key>` or `X-MCP-API-Key: <key>` are allowed. Use this so only people who have the key can use your deployed MCP.

## API Documentation

- [Intervals.icu API Docs](https://intervals.icu/api-docs.html)
- [Forum Discussion](https://forum.intervals.icu/t/api-access-to-intervals-icu/609)

## License

MIT
