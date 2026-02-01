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
2. Add environment variable: `INTERVALS_ICU_API_KEY`
3. Deploy
4. Copy deployment URL

## Configure Claude Code

Add to your Claude Code MCP settings (`mcp.json`):

```json
{
  "mcpServers": {
    "intervals-icu": {
      "url": "https://your-deployment.vercel.app/api/mcp"
    }
  }
}
```

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

Uses Basic Authentication with:
- Username: `API_KEY`
- Password: Your actual API key

The authenticated user is referenced as athlete ID `"0"`.

## API Documentation

- [Intervals.icu API Docs](https://intervals.icu/api-docs.html)
- [Forum Discussion](https://forum.intervals.icu/t/api-access-to-intervals-icu/609)

## License

MIT
