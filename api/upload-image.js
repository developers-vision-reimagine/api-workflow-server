import { corsHeaders, handleOptions } from './_helpers.js';

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(res);
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Read raw body as buffer
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);

    // Parse multipart form data manually (or use the raw buffer)
    // For Vercel, we'll accept base64 JSON as an alternative
    const contentType = req.headers['content-type'] || '';

    let imageBuffer;

    if (contentType.includes('application/json')) {
      // Accept JSON with base64 image
      const body = JSON.parse(rawBody.toString());
      imageBuffer = Buffer.from(body.imageBase64, 'base64');
    } else if (contentType.includes('multipart/form-data')) {
      // Extract image from multipart form data
      // Find boundary
      const boundary = contentType.split('boundary=')[1];
      if (!boundary) throw new Error('No boundary in multipart form data');

      const bodyStr = rawBody.toString('binary');
      const parts = bodyStr.split(`--${boundary}`);

      for (const part of parts) {
        if (part.includes('name="image"') || part.includes('name="file"')) {
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) continue;
          const content = part.slice(headerEnd + 4);
          // Remove trailing \r\n-- if present
          const cleanContent = content.replace(/\r\n--\r\n$/, '').replace(/\r\n$/, '');
          imageBuffer = Buffer.from(cleanContent, 'binary');
          break;
        }
      }

      if (!imageBuffer) throw new Error('No image found in form data');
    } else {
      throw new Error('Unsupported content type. Send multipart/form-data or application/json with imageBase64.');
    }

    // Compress with sharp
    const sharp = (await import('sharp')).default;
    const compressed = await sharp(imageBuffer)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    console.log('Image compressed to:', Math.round(compressed.length / 1024), 'KB');

    // Upload to catbox.moe
    const blob = new Blob([compressed], { type: 'image/jpeg' });
    const formData = new FormData();
    formData.append('reqtype', 'fileupload');
    formData.append('fileToUpload', blob, 'image.jpg');

    const uploadRes = await fetch('https://catbox.moe/user/api.php', {
      method: 'POST',
      body: formData,
    });

    if (!uploadRes.ok) throw new Error('catbox.moe upload failed: ' + await uploadRes.text());

    const imageUrl = (await uploadRes.text()).trim();
    console.log('Image uploaded to:', imageUrl);
    res.json({ imageUrl });
  } catch (err) {
    console.error('Image upload error:', err.message);
    res.status(500).json({ error: 'Failed to upload image: ' + err.message });
  }
}
