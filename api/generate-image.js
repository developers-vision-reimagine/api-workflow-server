import { NANO_BANANA_BASE, getEnhancorKey, sleep, corsHeaders, handleOptions } from './_helpers.js';

export const config = {
  maxDuration: 150, // 2.5 minutes for polling
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(res);
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, imageUrl, imageUrls, resolution, aspectRatio } = req.body;
  const key = getEnhancorKey();

  try {
    const queueBody = {
      prompt,
      webhook_url: 'https://example.com/webhook',
      resolution: resolution || '2K',
      output_format: 'png',
    };
    if (aspectRatio) queueBody.aspect_ratio = aspectRatio;
    const allImages = imageUrls || (imageUrl ? [imageUrl] : []);
    if (allImages.length > 0) queueBody.image_input = allImages;

    const queueRes = await fetch(`${NANO_BANANA_BASE}/queue`, {
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
      const statusRes = await fetch(`${NANO_BANANA_BASE}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ request_id: requestId }),
      });
      const statusText = await statusRes.text();
      let statusData;
      try { statusData = JSON.parse(statusText); } catch { throw new Error(statusText); }
      if (statusData.status === 'COMPLETED') return res.json({ outputUrl: statusData.result });
      if (statusData.status === 'FAILED') throw new Error('Image generation failed');
    }
    throw new Error('Timed out waiting for image generation');
  } catch (err) {
    console.error('Nano Banana error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
