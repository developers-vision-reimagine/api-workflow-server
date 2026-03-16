import { SKIN_FIX_BASE, enhancorQueueAndPoll, corsHeaders, handleOptions } from './_helpers.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(res);
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    imageUrl, modelVersion, enhancementMode, enhancementType,
    skin_refinement_level, skin_realism_Level, portrait_depth,
    output_resolution, processing_mode, preset_name,
    mask_image_url, mask_expand, enhancement_strength,
    freckle_intensity, fast_mode, fix_lighting_mode,
    forehead, left_cheek, right_cheek, nose, chin,
    upper_lip, lower_lip, neck, left_eye_area, right_eye_area,
    jaw_line, temples,
  } = req.body;

  try {
    const queueBody = { img_url: imageUrl };
    const optionalFields = {
      model_version: modelVersion, enhancementMode, enhancementType,
      skin_refinement_level, skin_realism_Level, portrait_depth,
      output_resolution, processing_mode, preset_name,
      mask_image_url, mask_expand, enhancement_strength,
      freckle_intensity, fast_mode, fix_lighting_mode,
      forehead, left_cheek, right_cheek, nose, chin,
      upper_lip, lower_lip, neck, left_eye_area, right_eye_area,
      jaw_line, temples,
    };
    Object.entries(optionalFields).forEach(([k, v]) => { if (v !== undefined) queueBody[k] = v; });

    const result = await enhancorQueueAndPoll(SKIN_FIX_BASE, queueBody, 'Skin Fix');
    res.json({ outputUrl: result });
  } catch (err) {
    console.error('Skin Fix error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
