import { IMAGE_UPSCALER_BASE, enhancorQueueAndPoll, corsHeaders, handleOptions } from './_helpers.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(res);
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageUrl } = req.body;
  try {
    const queueBody = { img_url: imageUrl };
    const result = await enhancorQueueAndPoll(IMAGE_UPSCALER_BASE, queueBody, 'Image Upscaler');
    res.json({ outputUrl: result });
  } catch (err) {
    console.error('Image Upscaler error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
