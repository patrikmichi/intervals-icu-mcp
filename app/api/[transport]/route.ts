import { z } from 'zod';
import { createMcpHandler } from 'mcp-handler';

export const maxDuration = 60;

// ============================================================================
// Configuration
// ============================================================================

function getConfig(): { apiKey: string; baseUrl: string } {
  const apiKey = process.env.INTERVALS_ICU_API_KEY;
  if (!apiKey) {
    throw new Error('Missing INTERVALS_ICU_API_KEY environment variable');
  }
  return {
    apiKey,
    baseUrl: process.env.INTERVALS_ICU_BASE_URL || 'https://intervals.icu/api/v1',
  };
}

/** If MCP_API_KEY is set in Vercel, client must send it (Authorization: Bearer <key> or X-MCP-API-Key). */
function getMcpKeyFromRequest(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return request.headers.get('X-MCP-API-Key')?.trim() ?? null;
}

// ============================================================================
// API Helper
// ============================================================================

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: string;
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * Intervals.icu API client with Basic Auth
 * Username: "API_KEY", Password: actual API key
 */
async function intervalsApi<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, params } = options;
  const { apiKey, baseUrl } = getConfig();

  const url = new URL(`${baseUrl}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  // Basic Auth with username="API_KEY" and password=actual_key
  const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url.toString(), {
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (response.status === 429) {
      // Rate limiting - retry with exponential backoff
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
      continue;
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Intervals.icu API ${response.status}: ${errorBody}`);
    }

    if (response.status === 204) return {} as T;

    // Handle CSV responses
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('text/csv')) {
      const text = await response.text();
      return text as T;
    }

    return response.json() as Promise<T>;
  }

  throw new Error(`Failed after retries: ${path}`);
}

/** Fetch a binary or file response and return as base64 (for event download .zwo/.mrc/.erg). */
async function intervalsApiDownload(path: string): Promise<{ base64: string; contentType: string }> {
  const { apiKey, baseUrl } = getConfig();
  const url = `${baseUrl}${path}`;
  const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Basic ${auth}` },
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Intervals.icu API ${response.status}: ${err}`);
  }
  const buf = await response.arrayBuffer();
  const base64 = Buffer.from(buf).toString('base64');
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  return { base64, contentType };
}

const json = (d: unknown) => ({ type: 'text' as const, text: JSON.stringify(d, null, 2) });

// ============================================================================
// MCP Handler
// ============================================================================

const handler = createMcpHandler(
  (server) => {
    // ========================================================================
    // Health Check
    // ========================================================================

    server.tool(
      'ping',
      'Health check - verify API connectivity and authentication.',
      { check_api: z.boolean().optional().describe('If true, makes a test API call to verify credentials') },
      async ({ check_api }) => {
        if (check_api) {
          try {
            // Test API call - get calendars for authenticated user (id=0)
            await intervalsApi('/athlete/0/calendars');
            return { content: [json({ ok: true, api: 'connected', authenticated: true })] };
          } catch (e) {
            return { content: [json({ ok: false, error: String(e) })] };
          }
        }
        return { content: [json({ ok: true, env: true })] };
      }
    );

    // ========================================================================
    // Activities
    // ========================================================================

    server.tool(
      'fetch_activities',
      'Retrieve activities list in CSV format for the authenticated athlete. Returns activity data including dates, types, durations, distances, etc.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
      },
      async ({ athlete_id }) => {
        const id = athlete_id || '0';
        const csv = await intervalsApi<string>(`/athlete/${id}/activities.csv`);
        return { content: [{ type: 'text', text: csv }] };
      }
    );

    server.tool(
      'fetch_activities_list',
      'Retrieve activities as JSON list for a date range. Use oldest and newest in yyyy-MM-dd format.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        oldest: z.string().describe('Start date in yyyy-MM-dd format'),
        newest: z.string().describe('End date in yyyy-MM-dd format'),
      },
      async ({ athlete_id, oldest, newest }) => {
        const id = athlete_id || '0';
        const activities = await intervalsApi(`/athlete/${id}/activities`, {
          params: { oldest, newest },
        });
        return { content: [json(activities)] };
      }
    );

    server.tool(
      'get_activity',
      'Get detailed activity data including intervals and metrics.',
      {
        activity_id: z.string().describe('The activity ID'),
        include_intervals: z.boolean().optional().describe('Include interval data (default: true)'),
      },
      async ({ activity_id, include_intervals = true }) => {
        const params = include_intervals ? { intervals: 'true' } : {};
        const activity = await intervalsApi(`/activity/${activity_id}`, { params });
        return { content: [json(activity)] };
      }
    );

    server.tool(
      'update_activity',
      'Update an activity (e.g. name, type). Pass the activity object with fields to change.',
      {
        activity_id: z.string().describe('The activity ID to update'),
        body: z.record(z.unknown()).describe('Activity fields to update (e.g. { "name": "Morning run", "type": "Run" })'),
      },
      async ({ activity_id, body }) => {
        const activity = await intervalsApi(`/activity/${activity_id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        return { content: [json(activity)] };
      }
    );

    // ========================================================================
    // Calendars
    // ========================================================================

    server.tool(
      'fetch_calendars',
      'List all calendars for the authenticated athlete.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
      },
      async ({ athlete_id }) => {
        const id = athlete_id || '0';
        const calendars = await intervalsApi(`/athlete/${id}/calendars`);
        return { content: [json(calendars)] };
      }
    );

    // ========================================================================
    // Events
    // ========================================================================

    server.tool(
      'fetch_events',
      'List calendar events for a date range. Use this to view planned workouts, races, and other calendar entries.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        oldest: z.string().describe('Start date in yyyy-MM-dd format (required)'),
        newest: z.string().describe('End date in yyyy-MM-dd format (required)'),
        calendar_id: z.string().optional().describe('Optional calendar ID to filter events'),
      },
      async ({ athlete_id, oldest, newest, calendar_id }) => {
        const id = athlete_id || '0';
        const params: Record<string, string> = { oldest, newest };
        if (calendar_id) params.calendar_id = calendar_id;
        const events = await intervalsApi(`/athlete/${id}/events`, { params });
        return { content: [json(events)] };
      }
    );

    server.tool(
      'get_event',
      'Get a single calendar event by ID.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        event_id: z.string().describe('The event ID'),
      },
      async ({ athlete_id, event_id }) => {
        const id = athlete_id || '0';
        const event = await intervalsApi(`/athlete/${id}/events/${event_id}`);
        return { content: [json(event)] };
      }
    );

    server.tool(
      'create_event',
      'Create a planned workout or calendar event.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        start_date_local: z.string().describe('Event start date in yyyy-MM-dd or yyyy-MM-ddTHH:mm:ss format (API requires T00:00:00)'),
        type: z.string().optional().describe('Event type (e.g., "Ride", "Run", "Swim")'),
        category: z.string().optional().describe('Event category (e.g., "WORKOUT", "Race", "Note")'),
        name: z.string().optional().describe('Event name/title'),
        description: z.string().optional().describe('Event description or workout details'),
        workout_id: z.string().optional().describe('Workout ID from library to use as template'),
        duration: z.number().optional().describe('Planned duration in seconds (sent as moving_time to API)'),
        distance: z.number().optional().describe('Planned distance in meters'),
      },
      async ({ athlete_id, start_date_local, type, category, name, description, workout_id, duration, distance }) => {
        const id = athlete_id || '0';
        // API requires start_date_local with time, e.g. 2020-05-01T00:00:00
        const normalizedDate =
          /^\d{4}-\d{2}-\d{2}T/.test(start_date_local) ? start_date_local : `${start_date_local}T00:00:00`;

        const payload: Record<string, unknown> = { start_date_local: normalizedDate };

        if (type) payload.type = type;
        if (category) payload.category = category;
        if (name) payload.name = name;
        if (description) payload.description = description;
        if (workout_id) payload.workout_id = workout_id;
        // API expects moving_time (seconds), not duration
        if (duration != null) payload.moving_time = duration;
        if (distance) payload.distance = distance;

        const event = await intervalsApi(`/athlete/${id}/events`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return { content: [json(event)] };
      }
    );

    server.tool(
      'update_event',
      'Update an existing calendar event. Pass the event object with fields to change (e.g. name, description, start_date_local, moving_time).',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        event_id: z.string().describe('The event ID to update'),
        body: z.record(z.unknown()).describe('Event fields to update (JSON object, e.g. { "name": "New title", "moving_time": 3600 })'),
      },
      async ({ athlete_id, event_id, body }) => {
        const id = athlete_id || '0';
        const event = await intervalsApi(`/athlete/${id}/events/${event_id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        return { content: [json(event)] };
      }
    );

    server.tool(
      'delete_event',
      'Delete a calendar event by ID.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        event_id: z.string().describe('The event ID to delete'),
      },
      async ({ athlete_id, event_id }) => {
        const id = athlete_id || '0';
        await intervalsApi(`/athlete/${id}/events/${event_id}`, { method: 'DELETE' });
        return { content: [json({ deleted: true, event_id })] };
      }
    );

    server.tool(
      'download_event',
      'Download a planned workout/event as .zwo, .mrc, or .erg file. Returns file content as base64; decode and save with the given extension.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        event_id: z.string().describe('The event ID'),
        ext: z.enum(['zwo', 'mrc', 'erg']).describe('File format: zwo (Zwift), mrc (ERG), erg'),
      },
      async ({ athlete_id, event_id, ext }) => {
        const id = athlete_id || '0';
        const file = await intervalsApiDownload(`/athlete/${id}/events/${event_id}/download.${ext}`);
        return { content: [json({ ext, contentType: file.contentType, base64: file.base64, note: 'Decode base64 to get file bytes; save with .' + ext + ' extension' })] };
      }
    );

    // ========================================================================
    // Workouts
    // ========================================================================

    server.tool(
      'fetch_workouts',
      'List workouts in the athlete\'s workout library.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
      },
      async ({ athlete_id }) => {
        const id = athlete_id || '0';
        const workouts = await intervalsApi(`/athlete/${id}/workouts`);
        return { content: [json(workouts)] };
      }
    );

    server.tool(
      'get_workout',
      'Get a single workout from the library by ID.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        workout_id: z.string().describe('The workout ID'),
      },
      async ({ athlete_id, workout_id }) => {
        const id = athlete_id || '0';
        const workout = await intervalsApi(`/athlete/${id}/workouts/${workout_id}`);
        return { content: [json(workout)] };
      }
    );

    server.tool(
      'create_workout',
      'Add a workout to the athlete\'s workout library.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        name: z.string().describe('Workout name'),
        description: z.string().optional().describe('Workout description'),
        category: z.string().optional().describe('Activity category (e.g., "Run", "Ride", "Swim")'),
        steps: z.array(z.unknown()).optional().describe('Workout steps/structure (array of step objects)'),
      },
      async ({ athlete_id, name, description, category, steps }) => {
        const id = athlete_id || '0';
        const payload: Record<string, unknown> = { name };

        if (description) payload.description = description;
        if (category) payload.category = category;
        if (steps) payload.steps = steps;

        const workout = await intervalsApi(`/athlete/${id}/workouts`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return { content: [json(workout)] };
      }
    );

    server.tool(
      'update_workout',
      'Update an existing workout in the library. Pass the workout object with fields to change.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        workout_id: z.string().describe('The workout ID to update'),
        body: z.record(z.unknown()).describe('Workout fields to update (JSON object, e.g. { "name": "New name", "description": "..." })'),
      },
      async ({ athlete_id, workout_id, body }) => {
        const id = athlete_id || '0';
        const workout = await intervalsApi(`/athlete/${id}/workouts/${workout_id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        return { content: [json(workout)] };
      }
    );

    server.tool(
      'delete_workout',
      'Delete a workout from the library by ID.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        workout_id: z.string().describe('The workout ID to delete'),
      },
      async ({ athlete_id, workout_id }) => {
        const id = athlete_id || '0';
        await intervalsApi(`/athlete/${id}/workouts/${workout_id}`, { method: 'DELETE' });
        return { content: [json({ deleted: true, workout_id })] };
      }
    );

    server.tool(
      'fetch_folders',
      'List all workout folders (and their workouts) for the athlete.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
      },
      async ({ athlete_id }) => {
        const id = athlete_id || '0';
        const folders = await intervalsApi(`/athlete/${id}/folders`);
        return { content: [json(folders)] };
      }
    );

    server.tool(
      'create_folder',
      'Create a workout folder.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        name: z.string().describe('Folder name'),
        description: z.string().optional().describe('Folder description'),
        type: z.string().optional().describe('Folder type'),
      },
      async ({ athlete_id, name, description, type }) => {
        const id = athlete_id || '0';
        const payload: Record<string, unknown> = { name };
        if (description) payload.description = description;
        if (type) payload.type = type;
        const folder = await intervalsApi(`/athlete/${id}/folders`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return { content: [json(folder)] };
      }
    );

    server.tool(
      'update_folder',
      'Update a workout folder (name, description, etc.).',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        folder_id: z.string().describe('The folder ID to update'),
        body: z.record(z.unknown()).describe('Folder fields to update (e.g. { "name": "New name" })'),
      },
      async ({ athlete_id, folder_id, body }) => {
        const id = athlete_id || '0';
        const folder = await intervalsApi(`/athlete/${id}/folders/${folder_id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        return { content: [json(folder)] };
      }
    );

    server.tool(
      'delete_folder',
      'Delete a workout folder by ID.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        folder_id: z.string().describe('The folder ID to delete'),
      },
      async ({ athlete_id, folder_id }) => {
        const id = athlete_id || '0';
        await intervalsApi(`/athlete/${id}/folders/${folder_id}`, { method: 'DELETE' });
        return { content: [json({ deleted: true, folder_id })] };
      }
    );

    server.tool(
      'get_folder_shared_with',
      'Show who a folder has been shared with.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        folder_id: z.string().describe('The folder ID'),
      },
      async ({ athlete_id, folder_id }) => {
        const id = athlete_id || '0';
        const data = await intervalsApi(`/athlete/${id}/folders/${folder_id}/shared-with`);
        return { content: [json(data)] };
      }
    );

    server.tool(
      'update_folder_shared_with',
      'Update folder sharing (who the folder is shared with).',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        folder_id: z.string().describe('The folder ID to update sharing for'),
        body: z.record(z.unknown()).describe('Sharing payload (structure per Intervals.icu API)'),
      },
      async ({ athlete_id, folder_id, body }) => {
        const id = athlete_id || '0';
        const data = await intervalsApi(`/athlete/${id}/folders/${folder_id}/shared-with`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        return { content: [json(data)] };
      }
    );

    // ========================================================================
    // Wellness
    // ========================================================================

    server.tool(
      'fetch_wellness',
      'Get wellness data for a date or date range (resting HR, sleep, stress, mood, etc.).',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        oldest: z.string().describe('Start date in yyyy-MM-dd format'),
        newest: z.string().optional().describe('End date in yyyy-MM-dd format. Omit for single-day wellness.'),
      },
      async ({ athlete_id, oldest, newest }) => {
        const id = athlete_id || '0';
        const params: Record<string, string> = newest ? { oldest, newest } : {};
        const url = newest ? `/athlete/${id}/wellness` : `/athlete/${id}/wellness/${oldest}`;
        const wellness = await intervalsApi(url, Object.keys(params).length ? { params } : {});
        return { content: [json(wellness)] };
      }
    );

    server.tool(
      'update_wellness',
      'Update wellness data for a date (e.g. restingHR, sleepSecs, mood). Pass the wellness object; id must be the date in yyyy-MM-dd.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        date: z.string().describe('Wellness date in yyyy-MM-dd format'),
        body: z.record(z.unknown()).describe('Wellness fields to update (e.g. { "restingHR": 55, "sleepSecs": 28800 })'),
      },
      async ({ athlete_id, date, body }) => {
        const id = athlete_id || '0';
        const payload = { id: date, ...body };
        const wellness = await intervalsApi(`/athlete/${id}/wellness/${date}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        return { content: [json(wellness)] };
      }
    );

    // ========================================================================
    // Power curves
    // ========================================================================

    server.tool(
      'fetch_power_curves',
      'Get power curves for the athlete (e.g. 90d curve for Ride). Optional filters and newest date.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        curves: z.string().optional().describe('Curves to return (e.g. "90d", default "90d")'),
        type: z.string().optional().describe('Activity type (e.g. "Ride", "Run", default "Ride")'),
        newest: z.string().optional().describe('Newest date/time for activities to include (yyyy-MM-dd or yyyy-MM-ddTHH:mm:ss)'),
        include_ranks: z.boolean().optional().describe('Include ranks (default false)'),
        sub_max_efforts: z.number().optional().describe('Number of sub-max efforts (default 0)'),
        filters: z.string().optional().describe('JSON filter array, e.g. [{"field_id":"type","value":["Ride","VirtualRide"]}]'),
      },
      async ({ athlete_id, curves, type, newest, include_ranks, sub_max_efforts, filters }) => {
        const id = athlete_id || '0';
        const params: Record<string, string> = {};
        if (curves) params.curves = curves;
        if (type) params.type = type;
        if (newest) params.newest = newest.includes('T') ? newest : `${newest}T00:00:00`;
        if (include_ranks != null) params.includeRanks = String(include_ranks);
        if (sub_max_efforts != null) params.subMaxEfforts = String(sub_max_efforts);
        if (filters) params.filters = filters;
        const data = await intervalsApi(`/athlete/${id}/power-curves`, { params });
        return { content: [json(data)] };
      }
    );
  },
  {},
  { basePath: '/api' }
);

async function requireMcpApiKey(
  request: Request,
  next: (req: Request) => Promise<Response>
): Promise<Response> {
  const expected = process.env.MCP_API_KEY;
  if (!expected) return next(request);

  const sent = getMcpKeyFromRequest(request);
  if (!sent || sent !== expected) {
    return new Response(
      JSON.stringify({
        error: 'Unauthorized',
        hint: 'Set MCP_API_KEY in Vercel env and send it in mcp.json headers, e.g. "Authorization": "Bearer YOUR_MCP_API_KEY" or "X-MCP-API-Key": "YOUR_MCP_API_KEY"',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return next(request);
}

export async function GET(request: Request) {
  return requireMcpApiKey(request, handler);
}
export async function POST(request: Request) {
  return requireMcpApiKey(request, handler);
}
export async function DELETE(request: Request) {
  return requireMcpApiKey(request, handler);
}
