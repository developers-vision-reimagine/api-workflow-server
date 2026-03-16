import { getAnthropic, corsHeaders, handleOptions } from './_helpers.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(res);
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userPrompt, systemDirections } = req.body;
  try {
    const message = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemDirections,
      messages: [{ role: 'user', content: userPrompt }],
    });
    res.json({ adaptedPrompt: message.content[0].text });
  } catch (err) {
    console.error('Anthropic API error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
