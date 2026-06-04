// This Edge Function is no longer used for scoring.
// AI scoring has been moved to the n8n workflow "Del Score Task — AI Scoring Pipeline".
// del-submit-task fires a POST to N8N_DEL_SCORING_WEBHOOK (set in Edge Function env).
// The n8n workflow handles: prompt build → Claude Haiku → del_points write → task under_review.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(() =>
  new Response(
    JSON.stringify({ message: 'Scoring is handled by n8n workflow. This endpoint is a stub.' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ),
)
