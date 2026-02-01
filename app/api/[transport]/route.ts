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
      },
      async ({ athlete_id, oldest, newest }) => {
        const id = athlete_id || '0';
        const events = await intervalsApi(`/athlete/${id}/events`, {
          params: { oldest, newest },
        });
        return { content: [json(events)] };
      }
    );

    server.tool(
      'create_event',
      'Create a planned workout or calendar event.',
      {
        athlete_id: z.string().optional().describe('Athlete ID. Use "0" for authenticated user (default)'),
        start_date_local: z.string().describe('Event start date in yyyy-MM-dd format'),
        type: z.string().optional().describe('Event type (e.g., "Workout", "Race", "Note")'),
        category: z.string().optional().describe('Activity category (e.g., "Run", "Ride", "Swim")'),
        name: z.string().optional().describe('Event name/title'),
        description: z.string().optional().describe('Event description or workout details'),
        workout_id: z.string().optional().describe('Workout ID from library to use as template'),
        duration: z.number().optional().describe('Planned duration in seconds'),
        distance: z.number().optional().describe('Planned distance in meters'),
      },
      async ({ athlete_id, start_date_local, type, category, name, description, workout_id, duration, distance }) => {
        const id = athlete_id || '0';
        const payload: Record<string, unknown> = { start_date_local };

        if (type) payload.type = type;
        if (category) payload.category = category;
        if (name) payload.name = name;
        if (description) payload.description = description;
        if (workout_id) payload.workout_id = workout_id;
        if (duration) payload.duration = duration;
        if (distance) payload.distance = distance;

        const event = await intervalsApi(`/athlete/${id}/events`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return { content: [json(event)] };
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
