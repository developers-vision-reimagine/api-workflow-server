import { KLING_V3_BASE, enhancorQueueAndPoll, corsHeaders, handleOptions } from './_helpers.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(res);
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, imageUrls, mode, duration, sound, aspectRatio } = req.body;
  try {
    const queueBody = { prompt };
    if (imageUrls !== undefined) queueBody.image_input = imageUrls;
    if (mode !== undefined) queueBody.mode = mode;
    if (duration !== undefined) queueBody.duration = duration;
    if (sound !== undefined) queueBody.sound = sound;
    if (aspectRatio !== undefined) queueBody.aspect_ratio = aspectRatio;
    const result = await enhancorQueueAndPoll(KLING_V3_BASE, queueBody, 'Kling V3');
    res.json({ outputUrl: result });
  } catch (err) {
    console.error('Kling V3 error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
