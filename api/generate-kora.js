import { KORA_REALITY_BASE, getEnhancorKey, sleep, corsHeaders, handleOptions } from './_helpers.js';

export const config = {
  maxDuration: 150,
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(res);
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, aspectRatio, resolution, mode } = req.body;
  const key = getEnhancorKey();

  const ASPECT_MAP = {
    '1:1': 'square', '16:9': 'landscape16:9', '9:16': 'portrait9:16',
    '4:3': 'landscape4:3', '3:4': 'portrait3:4', '3:2': 'landscape4:3', '2:3': 'portrait3:4',
  };
  const RES_MAP = { '1K': 'hd', '2K': '2k', '4K': '2k' };

  try {
    const queueBody = {
      prompt,
      webhook_url: 'https://example.com/webhook',
      aspect_ratio: ASPECT_MAP[aspectRatio] || 'portrait3:4',
      resolution: RES_MAP[resolution] || 'hd',
      mode: mode || 'realistic',
      is_uncensored: true,
      is_hyper_real: false,
      enable_upscale: false,
    };

    const queueRes = await fetch(`${KORA_REALITY_BASE}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify(queueBody),
    });

    const queueText = await queueRes.text();
    let queueData;
    try { queueData = JSON.parse(queueText); } catch { throw new Error(queueText); }
    if (!queueData.success) throw new Error(JSON.stringify(queueData));

    const requestId = queueData.requestId;

    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(2000);
      const statusRes = await fetch(`${KORA_REALITY_BASE}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ request_id: requestId }),
      });
      const statusText = await statusRes.text();
      let statusData;
      try { statusData = JSON.parse(statusText); } catch { throw new Error(statusText); }
      if (statusData.status === 'COMPLETED') return res.json({ outputUrl: statusData.result });
      if (statusData.status === 'FAILED') throw new Error('Kora Reality generation failed');
    }
    throw new Error('Timed out waiting for Kora Reality generation');
  } catch (err) {
    console.error('Kora Reality error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
