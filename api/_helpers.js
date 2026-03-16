/**
 * Shared helpers for Vercel serverless functions.
 * Files prefixed with _ are NOT exposed as routes by Vercel.
 */
import Anthropic from '@anthropic-ai/sdk';

// Singleton Anthropic client
let _anthropic;
export function getAnthropic() {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

// Base URLs for Enhancor services
export const NANO_BANANA_BASE = 'https://apireq.enhancor.ai/api/nano-banana-2/v1';
export const KORA_REALITY_BASE = 'https://apireq.enhancor.ai/api/kora-reality/v1';
export const SKIN_FIX_BASE = 'https://apireq.enhancor.ai/api/realistic-skin/v1';
export const PORTRAIT_UPSCALER_BASE = 'https://apireq.enhancor.ai/api/upscaler/v1';
export const IMAGE_UPSCALER_BASE = 'https://apireq.enhancor.ai/api/image-upscaler/v1';
export const CRISP_UPSCALER_BASE = 'https://apireq.enhancor.ai/api/crisp-upscaler/v1';
export const KLING_V3_BASE = 'https://apireq.enhancor.ai/api/kling-v3/v1';

export function getEnhancorKey() {
  return process.env.NANO_BANANA_API_KEY;
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Generic queue + poll for Enhancor services.
 */
export async function enhancorQueueAndPoll(baseUrl, queueBody, label, maxAttempts = 120, interval = 3000) {
  const key = getEnhancorKey();

  const queueRes = await fetch(`${baseUrl}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify(queueBody),
  });

  const queueText = await queueRes.text();
  let queueData;
  try { queueData = JSON.parse(queueText); } catch { throw new Error(queueText); }
  if (!queueData.success) throw new Error(JSON.stringify(queueData));

  const requestId = queueData.requestId;
  console.log(`${label} job queued:`, requestId);

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(interval);
    const statusRes = await fetch(`${baseUrl}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ request_id: requestId }),
    });
    const statusText = await statusRes.text();
    let statusData;
    try { statusData = JSON.parse(statusText); } catch { throw new Error(statusText); }
    console.log(`${label} poll ${i + 1}: ${statusData.status}`);
    if (statusData.status === 'COMPLETED') return statusData.result;
    if (statusData.status === 'FAILED') throw new Error(`${label} generation failed`);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/**
 * CORS headers for all API responses.
 */
export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

/**
 * Handle CORS preflight.
 */
export function handleOptions(res) {
  res.writeHead(204, corsHeaders());
  res.end();
}
