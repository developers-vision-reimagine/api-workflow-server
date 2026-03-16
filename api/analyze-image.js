import { getAnthropic, corsHeaders, handleOptions } from './_helpers.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(res);
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mediaType, systemPrompt, userPrompt } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

  const defaultText = 'Analyze this image in detail. Describe the subject, composition, colors, lighting, style, mood, and any notable elements. Be concise but thorough — this description will be used to inform an image generation prompt.';
  const userText = userPrompt
    ? `USER PROMPT:\n${userPrompt}\n\nAnalyze the image above in the context of the user prompt.`
    : defaultText;

  try {
    const apiParams = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: userText },
        ],
      }],
    };
    if (systemPrompt) apiParams.system = systemPrompt;

    const message = await getAnthropic().messages.create(apiParams);
    res.json({ analysis: message.content[0].text });
  } catch (err) {
    console.error('Vision API error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
