# Intervals.icu MCP Server

MCP server for [Intervals.icu](https://intervals.icu) - training analytics and workout management platform.

## Features

Access Intervals.icu data through 8 MCP tools:

- **Activities**: Fetch activities list (CSV), get detailed activity data with intervals
- **Calendars**: List calendars
- **Events**: Fetch calendar events, create planned workouts
- **Workouts**: List workout library, create workouts

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

### `ping`
Health check - verify API connectivity and authentication.

### `fetch_activities`
Retrieve activities list in CSV format. Returns activity data including dates, types, durations, distances, etc.

### `get_activity`
Get detailed activity data including intervals and metrics.

### `fetch_calendars`
List all calendars for the authenticated athlete.

### `fetch_events`
List calendar events for a date range. View planned workouts, races, and other calendar entries.

### `create_event`
Create a planned workout or calendar event.

### `fetch_workouts`
List workouts in the athlete's workout library.

### `create_workout`
Add a workout to the athlete's workout library.

## Authentication

- **INTERVALS_ICU_API_KEY** – Set in Vercel (or `.env.local`). Used by the server to call the Intervals.icu API (Basic Auth, username `API_KEY`, password = key). Athlete ID `"0"` is the authenticated user.
- **MCP_API_KEY** – Optional. If set in Vercel, only requests that send this value in `Authorization: Bearer <key>` or `X-MCP-API-Key: <key>` are allowed. Use this so only people who have the key can use your deployed MCP.

## API Documentation

- [Intervals.icu API Docs](https://intervals.icu/api-docs.html)
- [Forum Discussion](https://forum.intervals.icu/t/api-access-to-intervals-icu/609)

## License

MIT
