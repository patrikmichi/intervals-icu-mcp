import { NextResponse } from 'next/server';

export const maxDuration = 60;

// ============================================================================
// Config
// ============================================================================

function getIntervalsConfig(): { apiKey: string; baseUrl: string } {
  const apiKey = process.env.INTERVALS_ICU_API_KEY;
  if (!apiKey) {
    throw new Error('Missing INTERVALS_ICU_API_KEY');
  }
  return {
    apiKey,
    baseUrl: process.env.INTERVALS_ICU_BASE_URL || 'https://intervals.icu/api/v1',
  };
}

function checkWebhookAuth(request: Request): boolean {
  const secret = process.env.WEBHOOK_SECRET || process.env.MCP_API_KEY;
  if (!secret) return true; // no secret configured = allow all
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim() === secret;
  const headerSecret = request.headers.get('X-Webhook-Secret');
  return headerSecret === secret;
}

// ============================================================================
// Payload normalization (avoid Intervals API rejections)
// ============================================================================

/** Normalize start_date_local to include T00:00:00 if missing (API requirement). */
function normalizeStartDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00`;
  return s;
}

/** Build event payload for POST: only fields Intervals.icu accepts on create. */
function buildEventPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const start_date_local = normalizeStartDate(raw.start_date_local ?? raw.startDate);
  if (!start_date_local) {
    throw new Error('Missing or invalid start_date_local (use yyyy-MM-dd or yyyy-MM-ddT00:00:00)');
  }

  const payload: Record<string, unknown> = { start_date_local };

  if (raw.name != null) payload.name = String(raw.name);
  if (raw.description != null) payload.description = String(raw.description);
  if (raw.type != null) payload.type = String(raw.type);
  if (raw.category != null) payload.category = String(raw.category);
  if (raw.indoor != null) payload.indoor = Boolean(raw.indoor);
  if (raw.calendar_id != null) payload.calendar_id = Number(raw.calendar_id);
  if (raw.distance != null) payload.distance = Number(raw.distance);
  if (raw.color != null) payload.color = raw.color === null ? null : String(raw.color);

  // API expects moving_time (seconds); accept duration or moving_time
  const movingTime = raw.moving_time ?? raw.movingTime ?? raw.duration;
  if (movingTime != null) payload.moving_time = Number(movingTime);

  if (raw.workout_doc != null && typeof raw.workout_doc === 'object' && !Array.isArray(raw.workout_doc)) {
    payload.workout_doc = raw.workout_doc as Record<string, unknown>;
  }

  return payload;
}

// ============================================================================
// POST /api/webhook – receive JSON, post to Intervals.icu
// ============================================================================

export async function POST(request: Request) {
  try {
    if (!checkWebhookAuth(request)) {
      return NextResponse.json(
        { error: 'Unauthorized', hint: 'Set WEBHOOK_SECRET or MCP_API_KEY and send it in Authorization: Bearer <secret> or X-Webhook-Secret' },
        { status: 401 }
      );
    }

    // Read body as text first to avoid parser issues, then parse JSON
    let raw: unknown;
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        const text = await request.text();
        raw = text ? JSON.parse(text) : {};
      } catch {
        return NextResponse.json(
          { error: 'Invalid JSON body' },
          { status: 400 }
        );
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const form = await request.formData();
      const payloadField = form.get('payload') ?? form.get('json') ?? form.get('body');
      const rawStr = typeof payloadField === 'string' ? payloadField : null;
      if (!rawStr) {
        return NextResponse.json(
          { error: 'Missing form field: payload, json, or body (JSON string)' },
          { status: 400 }
        );
      }
      try {
        raw = JSON.parse(rawStr);
      } catch {
        return NextResponse.json(
          { error: 'Invalid JSON in payload field' },
          { status: 400 }
        );
      }
    } else {
      // Try to parse as JSON anyway (some clients don't set Content-Type)
      try {
        const text = await request.text();
        raw = text ? JSON.parse(text) : {};
      } catch {
        return NextResponse.json(
          { error: 'Expected JSON body or Content-Type: application/json' },
          { status: 400 }
        );
      }
    }

    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json(
        { error: 'Body must be a JSON object' },
        { status: 400 }
      );
    }

    const body = raw as Record<string, unknown>;
    const action = ((body.action ?? body._action ?? 'create') as string).toLowerCase();
    const athleteId = (body.athlete_id ?? body.athleteId ?? '0') as string;
    const eventId = (body.event_id ?? body.eventId) as string | undefined;

    const { apiKey, baseUrl } = getIntervalsConfig();
    const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');
    const baseUrlEvents = `${baseUrl}/athlete/${athleteId}/events`;

    if (action === 'delete') {
      if (!eventId) {
        return NextResponse.json(
          { error: 'Missing event_id for action "delete"' },
          { status: 400 }
        );
      }
      const response = await fetch(`${baseUrlEvents}/${eventId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Basic ${auth}` },
      });
      if (!response.ok) {
        const errText = await response.text();
        return NextResponse.json(
          { error: 'Intervals.icu API error', status: response.status, detail: errText },
          { status: response.status >= 500 ? 502 : 400 }
        );
      }
      return NextResponse.json({ ok: true, action: 'delete', event_id: eventId });
    }

    if (action === 'update') {
      if (!eventId) {
        return NextResponse.json(
          { error: 'Missing event_id for action "update"' },
          { status: 400 }
        );
      }
      const { event_id: _e, eventId: _e2, action: _a, _action: _a2, athlete_id: _aid, athleteId: _aid2, ...updateBody } = body;
      const payload = Object.keys(updateBody).length ? updateBody : {};
      const response = await fetch(`${baseUrlEvents}/${eventId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errText = await response.text();
        return NextResponse.json(
          { error: 'Intervals.icu API error', status: response.status, detail: errText },
          { status: response.status >= 500 ? 502 : 400 }
        );
      }
      const event = await response.json();
      return NextResponse.json({ ok: true, action: 'update', event });
    }

    // create (default)
    const payload = buildEventPayload(body);
    const response = await fetch(baseUrlEvents, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: 'Intervals.icu API error', status: response.status, detail: errText },
        { status: response.status >= 500 ? 502 : 400 }
      );
    }

    const event = await response.json();
    return NextResponse.json({ ok: true, action: 'create', event });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Webhook failed', detail: message },
      { status: 500 }
    );
  }
}

// Allow GET for health check
export async function GET() {
  return NextResponse.json({
    ok: true,
    webhook: 'intervals-event',
    actions: ['create', 'update', 'delete'],
    hint: 'POST JSON. create (default): start_date_local, name, type, category, moving_time, workout_doc, athlete_id. update: action="update", event_id, plus fields to change. delete: action="delete", event_id.',
  });
}
