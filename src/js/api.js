// api.js — single module for all Claude API calls
// Browser-direct, key never stored, sent over HTTPS only.

const API_URL = 'https://api.anthropic.com/v1/messages';
const HEADERS = (key) => ({
  'content-type': 'application/json',
  'x-api-key': key,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
});

// ── Core call ─────────────────────────────────────────────────
export async function claudeCall({ apiKey, model, system, user, maxTokens = 2048 }) {
  // system can be a string or an array of content blocks (for cache_control)
  const systemContent = Array.isArray(system)
    ? system
    : [{ type: 'text', text: system }];

  // user can be a plain string, content blocks array, or a caching config object
  // { blocks: [...contentBlocks] } enables cache_control on specific blocks
  let userContent;
  if (typeof user === 'string') {
    userContent = [{ type: 'text', text: user }];
  } else if (Array.isArray(user)) {
    userContent = user;
  } else {
    userContent = user; // pass through as-is
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: HEADERS(apiKey),
    body: JSON.stringify({
      model, max_tokens: maxTokens,
      system: systemContent,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  const text = data.content?.find(b => b.type === 'text')?.text || '';
  return {
    text,
    stopReason: data.stop_reason || 'end_turn',
    usage: data.usage || { input_tokens: 0, output_tokens: 0 },
  };
}

// ── JSON call with auto-retry on max_tokens ───────────────────
// Returns { data, usage, stopReason, retried }
export async function claudeJSON({ apiKey, model, system, user, maxTokens = 2048, onRetry }) {
  let attempt = 0;
  let currentMax = maxTokens;

  while (attempt < 2) {
    const { text, stopReason, usage } = await claudeCall({
      apiKey, model, system, user, maxTokens: currentMax,
    });

    console.log(`[claudeJSON] attempt ${attempt+1}, stop_reason: ${stopReason}, tokens out: ${usage.output_tokens}, model: ${model}`);
    console.log('[claudeJSON] raw response:\n', text);

    if (stopReason === 'max_tokens' && attempt === 0) {
      // Retry with 2× tokens and escalate to opus if not already
      const retryMax = currentMax * 2;
      const retryModel = 'claude-opus-4-8';
      console.warn(`[claudeJSON] max_tokens hit — retrying with maxTokens=${retryMax}, model=${retryModel}`);
      onRetry?.({ retryMax, retryModel });
      currentMax = retryMax;
      // bump model to opus for retry
      model = retryModel;
      attempt++;
      continue;
    }

    const cleaned = extractJSON(text);
    try {
      return {
        data: JSON.parse(cleaned),
        usage, stopReason,
        retried: attempt > 0,
      };
    } catch (e) {
      if (stopReason === 'max_tokens') {
        throw new Error(`Response truncated at ${currentMax} tokens and JSON is incomplete. Try reducing prompt complexity.`);
      }
      console.error('[claudeJSON] parse failed. cleaned:', cleaned);
      throw new Error(`Model returned invalid JSON. See console for full response.`);
    }
  }
}

// ── Balanced JSON extraction ──────────────────────────────────
function extractJSON(text) {
  // 1. Try ```json ... ``` fences anywhere in string
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();

  // 2. Find first { or [ and extract balanced structure
  const firstBrace   = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  let start = -1;
  if      (firstBrace === -1)   start = firstBracket;
  else if (firstBracket === -1) start = firstBrace;
  else                          start = Math.min(firstBrace, firstBracket);

  if (start !== -1) {
    const open  = text[start] === '{' ? '{' : '[';
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === open)  depth++;
      if (text[i] === close) { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
  }
  return text.trim();
}

// ── Cost estimator ────────────────────────────────────────────
const COST_PER_MILLION = {
  'claude-opus-4-8':   { input: 5,   output: 25 },
  'claude-sonnet-4-6': { input: 3,   output: 15 },
  'claude-haiku-4-5':  { input: 0.8, output: 4  },
};

export function estimateCost(model, inputTokens, outputTokens) {
  const rates = COST_PER_MILLION[model] || { input: 5, output: 25 };
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}
