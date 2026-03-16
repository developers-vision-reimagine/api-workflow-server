import { CRISP_UPSCALER_BASE, enhancorQueueAndPoll, corsHeaders, handleOptions } from './_helpers.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(res);
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageUrl, upscaleFactor } = req.body;
  try {
    const queueBody = { img_url: imageUrl };
    if (upscaleFactor !== undefined) queueBody.upscale_factor = upscaleFactor;
    const result = await enhancorQueueAndPoll(CRISP_UPSCALER_BASE, queueBody, 'Crisp Upscaler');
    res.json({ outputUrl: result });
  } catch (err) {
    console.error('Crisp Upscaler error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
