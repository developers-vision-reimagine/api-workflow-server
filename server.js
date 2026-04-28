import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import marketplaceSeed from "./src/data/marketplaceSeed.js";
import express from "express";
import cors from "cors";
import multer from "multer";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { verifyFirebaseToken } from "./firebaseAuth.js";
import { decryptMiddleware } from "./decrypt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isVercel = process.env.VERCEL === "1";

// Load .env manually (local dev only; Vercel injects env.)
if (!isVercel) {
  const envPath = join(__dirname, ".env");
  try {
    if (existsSync(envPath)) {
      const envFile = readFileSync(envPath, "utf-8");
      for (const line of envFile.split("\n")) {
        const idx = line.indexOf("=");
        if (idx > 0)
          process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }
  } catch (_) {}
}
// When running from repo root, backend uses ../.env
if (!isVercel && !process.env.ANTHROPIC_API_KEY) {
  const parentEnv = join(__dirname, "..", ".env");
  try {
    if (existsSync(parentEnv)) {
      const envFile = readFileSync(parentEnv, "utf-8");
      for (const line of envFile.split("\n")) {
        const idx = line.indexOf("=");
        if (idx > 0)
          process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }
  } catch (_) {}
}

// --- Marketplace: in-memory; on Vercel no persistence ---
const MARKETPLACE_FILE = join(__dirname, "marketplace-data.json");
let marketplaceListings = [];
if (isVercel) {
  marketplaceListings = [...marketplaceSeed];
} else {
  try {
    if (existsSync(MARKETPLACE_FILE)) {
      marketplaceListings = JSON.parse(readFileSync(MARKETPLACE_FILE, "utf-8"));
      console.log(
        `Loaded ${marketplaceListings.length} marketplace listings from file`,
      );
    } else {
      marketplaceListings = [...marketplaceSeed];
      console.log(
        `Initialized marketplace with ${marketplaceListings.length} seed listings`,
      );
    }
  } catch (err) {
    console.error("Failed to load marketplace data, using seed:", err.message);
    marketplaceListings = [...marketplaceSeed];
  }
}

function saveMarketplace() {
  if (isVercel) return;
  try {
    writeFileSync(
      MARKETPLACE_FILE,
      JSON.stringify(marketplaceListings, null, 2),
    );
  } catch (err) {
    console.error("Failed to save marketplace data:", err.message);
  }
}

const NANO_BANANA_BASE = "https://apireq.enhancor.ai/api/nano-banana-2/v1";
const KORA_REALITY_BASE = "https://apireq.enhancor.ai/api/kora-reality/v1";
const SKIN_FIX_BASE = "https://apireq.enhancor.ai/api/realistic-skin/v1";
const PORTRAIT_UPSCALER_BASE = "https://apireq.enhancor.ai/api/upscaler/v1";
const IMAGE_UPSCALER_BASE = "https://apireq.enhancor.ai/api/image-upscaler/v1";
const CRISP_UPSCALER_BASE = "https://apireq.enhancor.ai/api/crisp-upscaler/v1";
const KLING_V3_BASE = "https://apireq.enhancor.ai/api/kling-v3/v1";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Firebase authentication — protect all /api/* routes
app.use("/api", verifyFirebaseToken);

// Decrypt encrypted request bodies from the frontend
app.use("/api", decryptMiddleware);

// Serve uploaded images statically (local only; Vercel has no persistent disk)
if (!isVercel) {
  const uploadsDir = join(__dirname, "uploads");
  mkdirSync(uploadsDir, { recursive: true });
  app.use("/uploads", express.static(uploadsDir));
}

// File upload: memory on Vercel (serverless), disk locally
const upload = multer({
  storage: isVercel
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: join(__dirname, "uploads"),
        filename: (_req, file, cb) => {
          const ext = file.originalname.match(/\.\w+$/)?.[0] || ".png";
          cb(
            null,
            `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`,
          );
        },
      }),
  limits: { fileSize: 30 * 1024 * 1024 },
});

// Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Sanitize error messages to hide internal provider details
function sanitizeError(msg) {
  if (!msg) return "Something went wrong, please try again";
  return msg
    .replace(/claude[- ]?\w*/gi, "AI model")
    .replace(/anthropic/gi, "AI provider")
    .replace(/\(org:\s*[^)]+\)/gi, "")
    .replace(/model:\s*claude[^\s).]*/gi, "")
    .replace(/https:\/\/docs\.anthropic\.com[^\s)"]*/gi, "")
    .replace(/https:\/\/claude\.com[^\s)"]*/gi, "")
    .replace(/request_id[":=\s]+req_\w+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Retry wrapper for API calls (handles 429 rate limits)
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 =
        err.status === 429 || (err.message && err.message.includes("429"));
      if (is429 && attempt < maxRetries) {
        const waitSec = Math.min(15 * (attempt + 1), 60);
        console.log(
          `Rate limited, waiting ${waitSec}s before retry ${attempt + 1}/${maxRetries}...`,
        );
        await sleep(waitSec * 1000);
        continue;
      }
      if (is429) {
        throw new Error("Server is busy, please try again in a bit");
      }
      throw err;
    }
  }
}

// --- Prompt Adapter (Claude Haiku) ---
app.post("/api/adapt-prompt", async (req, res) => {
  const { userPrompt, systemDirections } = req.body;
  try {
    const message = await withRetry(() =>
      anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemDirections,
        messages: [{ role: "user", content: userPrompt }],
      }),
    );
    res.json({ adaptedPrompt: message.content[0].text });
  } catch (err) {
    console.error("Anthropic API error:", err.message);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// --- Image Upload (compress + upload to catbox.moe for a public URL) ---
app.post("/api/upload-image", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image provided" });
  try {
    // Compress image (buffer on Vercel, path locally)
    const input = req.file.buffer || req.file.path;
    const compressed = await sharp(input)
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    console.log(
      "Image compressed to:",
      Math.round(compressed.length / 1024),
      "KB",
    );

    // Upload to catbox.moe (no API key needed)
    const blob = new Blob([compressed], { type: "image/jpeg" });
    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("fileToUpload", blob, "image.jpg");

    const uploadRes = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: formData,
    });

    if (!uploadRes.ok) {
      throw new Error("catbox.moe upload failed: " + (await uploadRes.text()));
    }

    const imageUrl = (await uploadRes.text()).trim();
    console.log("Image uploaded to:", imageUrl);
    res.json({ imageUrl });
  } catch (err) {
    console.error("Image upload error:", err.message);
    res
      .status(500)
      .json({ error: "Failed to upload image: " + sanitizeError(err.message) });
  }
});

// --- Image Analyzer (Claude Sonnet 4.6 Vision) ---
app.post("/api/analyze-image", async (req, res) => {
  const { imageBase64, mediaType, systemPrompt, userPrompt } = req.body;
  if (!imageBase64) return res.status(400).json({ error: "No image provided" });

  const defaultText =
    "Analyze this image in detail. Describe the subject, composition, colors, lighting, style, mood, and any notable elements. Be concise but thorough — this description will be used to inform an image generation prompt.";
  const userText = userPrompt
    ? `USER PROMPT:\n${userPrompt}\n\nAnalyze the image above in the context of the user prompt.`
    : defaultText;

  try {
    const apiParams = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType || "image/jpeg",
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: userText,
            },
          ],
        },
      ],
    };
    if (systemPrompt) {
      apiParams.system = systemPrompt;
    }
    const message = await withRetry(() => anthropic.messages.create(apiParams));
    res.json({ analysis: message.content[0].text });
  } catch (err) {
    console.error("Vision API error:", err.message);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// --- Generate Image (Nano Banana) ---
app.post("/api/generate-image", async (req, res) => {
  const { prompt, imageUrl, imageUrls, resolution, aspectRatio } = req.body;
  const apiKey = req.headers["x-api-key"];

  try {
    // Step 1: Queue the job
    const queueBody = {
      prompt,
      webhook_url: "https://example.com/webhook", // placeholder — we poll instead
      resolution: resolution || "2K",
      output_format: "png",
    };
    if (aspectRatio) {
      queueBody.aspect_ratio =
        aspectRatio.toLowerCase() === "auto" ? "auto" : aspectRatio;
    }
    const allImages = imageUrls || (imageUrl ? [imageUrl] : []);
    if (allImages.length > 0) {
      queueBody.image_input = allImages;
    }

    console.log("Queuing Nano Banana job:", {
      prompt: prompt.substring(0, 80),
      hasImage: !!imageUrl,
    });

    const queueRes = await fetch(`${NANO_BANANA_BASE}/queue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(queueBody),
    });

    const queueText = await queueRes.text();
    let queueData;
    try {
      queueData = JSON.parse(queueText);
    } catch {
      throw new Error(queueText);
    }
    if (!queueData.success) {
      throw new Error(JSON.stringify(queueData));
    }

    const requestId = queueData.requestId;
    console.log("Job queued:", requestId);

    // Step 2: Poll for status
    const maxAttempts = 90; // up to ~3 minutes
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(4000);

      const statusRes = await fetch(`${NANO_BANANA_BASE}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ request_id: requestId }),
      });

      const statusText = await statusRes.text();
      let statusData;
      try {
        statusData = JSON.parse(statusText);
      } catch {
        throw new Error(statusText);
      }
      console.log(`Poll ${i + 1}: ${statusData.status}`);

      if (statusData.status === "COMPLETED") {
        return res.json({ outputUrl: statusData.result });
      }
      if (statusData.status === "FAILED") {
        throw new Error("Image generation failed");
      }
    }

    throw new Error("Timed out waiting for image generation");
  } catch (err) {
    console.error("Nano Banana error:", err.message);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// --- Generate Image (Kora Reality) ---
app.post("/api/generate-kora", async (req, res) => {
  const { prompt, aspectRatio, resolution, mode } = req.body;
  const apiKey = req.headers["x-api-key"];

  // Map UI aspect ratios to Kora format
  const ASPECT_MAP = {
    "1:1": "square",
    "16:9": "landscape16:9",
    "9:16": "portrait9:16",
    "4:3": "landscape4:3",
    "3:4": "portrait3:4",
    "3:2": "landscape4:3", // closest match
    "2:3": "portrait3:4", // closest match
  };

  // Map UI resolutions to Kora format
  const RES_MAP = { "1K": "hd", "2K": "2k", "4K": "2k" };

  try {
    const queueBody = {
      prompt,
      webhook_url: "https://example.com/webhook",
      aspect_ratio: ASPECT_MAP[aspectRatio] || "portrait3:4",
      resolution: RES_MAP[resolution] || "hd",
      mode: mode || "realistic",
      is_uncensored: true,
      is_hyper_real: false,
      enable_upscale: false,
    };

    console.log("Queuing Kora Reality job:", {
      prompt: prompt.substring(0, 80),
      aspect: queueBody.aspect_ratio,
    });

    const queueRes = await fetch(`${KORA_REALITY_BASE}/queue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(queueBody),
    });

    const queueText = await queueRes.text();
    let queueData;
    try {
      queueData = JSON.parse(queueText);
    } catch {
      throw new Error(queueText);
    }
    if (!queueData.success) {
      throw new Error(JSON.stringify(queueData));
    }

    const requestId = queueData.requestId;
    console.log("Kora job queued:", requestId);

    // Poll for status
    const maxAttempts = 90; // up to ~3 minutes
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(4000);

      const statusRes = await fetch(`${KORA_REALITY_BASE}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ request_id: requestId }),
      });

      const statusText = await statusRes.text();
      let statusData;
      try {
        statusData = JSON.parse(statusText);
      } catch {
        throw new Error(statusText);
      }
      console.log(`Kora poll ${i + 1}: ${statusData.status}`);

      if (statusData.status === "COMPLETED") {
        return res.json({ outputUrl: statusData.result });
      }
      if (statusData.status === "FAILED") {
        throw new Error("Kora Reality generation failed");
      }
    }

    throw new Error("Timed out waiting for Kora Reality generation");
  } catch (err) {
    console.error("Kora Reality error:", err.message);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// --- Helper: queue + poll for Enhancor services ---
async function enhancorQueueAndPoll(
  baseUrl,
  queueBody,
  label,
  key,
  maxAttempts = 120,
  interval = 6000,
) {
  // All Enhancor APIs require a webhook URL even when polling — add a no-op placeholder
  const webhookKey =
    "prompt" in queueBody && !("img_url" in queueBody)
      ? "webhook_url"
      : "webhookUrl";
  const bodyWithWebhook = {
    ...queueBody,
    [webhookKey]: "https://example.com/webhook",
  };

  const queueRes = await fetch(`${baseUrl}/queue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
    },
    body: JSON.stringify(bodyWithWebhook),
  });

  const queueText = await queueRes.text();
  let queueData;
  try {
    queueData = JSON.parse(queueText);
  } catch {
    throw new Error(queueText);
  }
  if (!queueData.success) {
    throw new Error(JSON.stringify(queueData));
  }

  const requestId = queueData.requestId;
  console.log(`${label} job queued:`, requestId);

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(interval);

    const statusRes = await fetch(`${baseUrl}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
      },
      body: JSON.stringify({ request_id: requestId }),
    });

    const statusText = await statusRes.text();
    let statusData;
    try {
      statusData = JSON.parse(statusText);
    } catch {
      throw new Error(statusText);
    }
    console.log(`${label} poll ${i + 1}: ${statusData.status}`);

    if (statusData.status === "COMPLETED") {
      return statusData.result;
    }
    if (statusData.status === "FAILED") {
      throw new Error(`${label} generation failed`);
    }
  }

  throw new Error(`Timed out waiting for ${label}`);
}

// --- Generate Skin Fix (Enhancor Skin Fix) ---
app.post("/api/generate-skinfix", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  const {
    imageUrl,
    modelVersion,
    enhancementMode,
    enhancementType,
    skin_refinement_level,
    skin_realism_Level,
    portrait_depth,
    output_resolution,
    processing_mode,
    preset_name,
    mask_image_url,
    mask_expand,
    enhancement_strength,
    freckle_intensity,
    fast_mode,
    fix_lighting_mode,
    // area control flags
    forehead,
    left_cheek,
    right_cheek,
    nose,
    chin,
    upper_lip,
    lower_lip,
    neck,
    left_eye_area,
    right_eye_area,
    jaw_line,
    temples,
  } = req.body;

  try {
    const queueBody = { img_url: imageUrl };
    if (modelVersion !== undefined) queueBody.model_version = modelVersion;
    if (enhancementMode !== undefined)
      queueBody.enhancementMode = enhancementMode;
    if (enhancementType !== undefined)
      queueBody.enhancementType = enhancementType;
    if (skin_refinement_level !== undefined)
      queueBody.skin_refinement_level = skin_refinement_level;
    if (skin_realism_Level !== undefined)
      queueBody.skin_realism_Level = skin_realism_Level;
    if (portrait_depth !== undefined) queueBody.portrait_depth = portrait_depth;
    if (output_resolution !== undefined)
      queueBody.output_resolution = output_resolution;
    if (processing_mode !== undefined)
      queueBody.processing_mode = processing_mode;
    if (preset_name !== undefined) queueBody.preset_name = preset_name;
    if (mask_image_url !== undefined) queueBody.mask_image_url = mask_image_url;
    if (mask_expand !== undefined) queueBody.mask_expand = mask_expand;
    if (enhancement_strength !== undefined)
      queueBody.enhancement_strength = enhancement_strength;
    if (freckle_intensity !== undefined)
      queueBody.freckle_intensity = freckle_intensity;
    if (fast_mode !== undefined) queueBody.fast_mode = fast_mode;
    if (fix_lighting_mode !== undefined)
      queueBody.fix_lighting_mode = fix_lighting_mode;
    // area control flags
    if (forehead !== undefined) queueBody.forehead = forehead;
    if (left_cheek !== undefined) queueBody.left_cheek = left_cheek;
    if (right_cheek !== undefined) queueBody.right_cheek = right_cheek;
    if (nose !== undefined) queueBody.nose = nose;
    if (chin !== undefined) queueBody.chin = chin;
    if (upper_lip !== undefined) queueBody.upper_lip = upper_lip;
    if (lower_lip !== undefined) queueBody.lower_lip = lower_lip;
    if (neck !== undefined) queueBody.neck = neck;
    if (left_eye_area !== undefined) queueBody.left_eye_area = left_eye_area;
    if (right_eye_area !== undefined) queueBody.right_eye_area = right_eye_area;
    if (jaw_line !== undefined) queueBody.jaw_line = jaw_line;
    if (temples !== undefined) queueBody.temples = temples;

    console.log("Queuing Skin Fix job:", {
      imageUrl: imageUrl?.substring(0, 60),
      modelVersion,
    });

    const result = await enhancorQueueAndPoll(
      SKIN_FIX_BASE,
      queueBody,
      "Skin Fix",
      apiKey,
    );
    res.json({ outputUrl: result });
  } catch (err) {
    console.error("Skin Fix error:", err.message);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// --- Generate Portrait Upscaler (Portrait Detailer) ---
app.post("/api/generate-portrait-upscaler", async (req, res) => {
  const { imageUrl, mode } = req.body;
  const apiKey = req.headers["x-api-key"];

  try {
    const queueBody = { img_url: imageUrl };
    if (mode !== undefined) queueBody.mode = mode;

    console.log("Queuing Portrait Upscaler job:", {
      imageUrl: imageUrl?.substring(0, 60),
      mode,
    });

    const result = await enhancorQueueAndPoll(
      PORTRAIT_UPSCALER_BASE,
      queueBody,
      "Portrait Upscaler",
      apiKey,
    );
    res.json({ outputUrl: result });
  } catch (err) {
    console.error("Portrait Upscaler error:", err.message);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// --- Generate Image Upscaler ---
app.post("/api/generate-image-upscaler", async (req, res) => {
  const { imageUrl } = req.body;
  const apiKey = req.headers["x-api-key"];

  try {
    const queueBody = { img_url: imageUrl };

    console.log("Queuing Image Upscaler job:", {
      imageUrl: imageUrl?.substring(0, 60),
    });

    const result = await enhancorQueueAndPoll(
      IMAGE_UPSCALER_BASE,
      queueBody,
      "Image Upscaler",
      apiKey,
    );
    res.json({ outputUrl: result });
  } catch (err) {
    console.error("Image Upscaler error:", err.message);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// --- Generate Crisp Upscaler ---
app.post("/api/generate-crisp-upscaler", async (req, res) => {
  const { imageUrl, upscaleFactor } = req.body;
  const apiKey = req.headers["x-api-key"];

  try {
    const queueBody = {
      img_url: imageUrl,
      upscale_factor: upscaleFactor ?? 2,
      webhook_url: "test",
    };

    console.log("Queuing Crisp Upscaler job:", {
      imageUrl: imageUrl?.substring(0, 60),
      upscaleFactor,
    });

    const result = await enhancorQueueAndPoll(
      CRISP_UPSCALER_BASE,
      queueBody,
      "Crisp Upscaler",
      apiKey,
    );
    res.json({ outputUrl: result });
  } catch (err) {
    console.error("Crisp Upscaler error:", err.message);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// --- Generate Kling V3 ---
app.post("/api/generate-kling", async (req, res) => {
  const { prompt, imageUrls, mode, duration, sound, aspectRatio } = req.body;
  const apiKey = req.headers["x-api-key"];

  try {
    const queueBody = { prompt };
    if (imageUrls !== undefined) queueBody.image_input = imageUrls;
    if (mode !== undefined) queueBody.mode = mode;
    if (duration !== undefined) queueBody.duration = duration;
    if (sound !== undefined) queueBody.sound = sound;
    if (aspectRatio !== undefined) queueBody.aspect_ratio = aspectRatio;

    console.log("Queuing Kling V3 job:", {
      prompt: prompt?.substring(0, 80),
      mode,
      duration,
    });

    const result = await enhancorQueueAndPoll(
      KLING_V3_BASE,
      queueBody,
      "Kling V3",
      apiKey,
    );
    res.json({ outputUrl: result });
  } catch (err) {
    console.error("Kling V3 error:", err.message);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// --- fal.ai helper: subscribe (queue + poll) ---
const FAL_KEY = process.env.FAL_AI_API_KEY;

async function falSubscribe(endpointId, input) {
  if (!FAL_KEY) throw new Error("FAL_AI_API_KEY not configured");

  // Submit to queue
  const submitRes = await fetch(`https://queue.fal.run/${endpointId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${FAL_KEY}`,
    },
    body: JSON.stringify(input),
  });
  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`fal.ai submit failed: ${errText}`);
  }
  const { request_id } = await submitRes.json();
  console.log(`fal.ai ${endpointId} queued:`, request_id);

  // Poll for status
  const maxAttempts = 120;
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(6000);
    const statusRes = await fetch(
      `https://queue.fal.run/${endpointId}/requests/${request_id}/status`,
      {
        headers: { Authorization: `Key ${FAL_KEY}` },
      },
    );
    const statusData = await statusRes.json();
    console.log(`fal.ai ${endpointId} poll ${i + 1}: ${statusData.status}`);

    if (statusData.status === "COMPLETED") {
      // Fetch result
      const resultRes = await fetch(
        `https://queue.fal.run/${endpointId}/requests/${request_id}`,
        {
          headers: { Authorization: `Key ${FAL_KEY}` },
        },
      );
      return await resultRes.json();
    }
    if (statusData.status === "FAILED") {
      throw new Error(`fal.ai ${endpointId} generation failed`);
    }
  }
  throw new Error(`Timed out waiting for fal.ai ${endpointId}`);
}

// --- Creatify Aurora (Avatar Lipsync) ---
app.post("/api/generate-aurora", async (req, res) => {
  const {
    imageUrl,
    audioUrl,
    prompt,
    resolution,
    guidanceScale,
    audioGuidanceScale,
  } = req.body;

  try {
    const input = {
      image_url: imageUrl,
      audio_url: audioUrl,
    };
    if (prompt) input.prompt = prompt;
    if (resolution) input.resolution = resolution;
    if (guidanceScale !== undefined) input.guidance_scale = guidanceScale;
    if (audioGuidanceScale !== undefined)
      input.audio_guidance_scale = audioGuidanceScale;

    console.log("Queuing Creatify Aurora job:", {
      imageUrl: imageUrl?.substring(0, 60),
      resolution,
    });

    const result = await falSubscribe("fal-ai/creatify/aurora", input);
    res.json({ outputUrl: result.video?.url });
  } catch (err) {
    console.error("Creatify Aurora error:", err.message);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// --- VEED Fabric 1.0 (Lipsync) ---
app.post("/api/generate-fabric-lipsync", async (req, res) => {
  const { imageUrl, audioUrl, text, resolution, voiceDescription } = req.body;

  try {
    // If text is provided and no audioUrl, use the text-to-video endpoint
    if (text && !audioUrl) {
      const input = {
        image_url: imageUrl,
        text: text,
        resolution: resolution || "720p",
      };
      if (voiceDescription) input.voice_description = voiceDescription;

      console.log("Queuing VEED Fabric TTS job:", {
        text: text?.substring(0, 60),
        resolution,
      });

      const result = await falSubscribe("veed/fabric-1.0/text", input);
      return res.json({ outputUrl: result.video?.url });
    }

    // Audio mode
    const input = {
      image_url: imageUrl,
      audio_url: audioUrl,
      resolution: resolution || "720p",
    };

    console.log("Queuing VEED Fabric lipsync job:", {
      imageUrl: imageUrl?.substring(0, 60),
      resolution,
    });

    const result = await falSubscribe("veed/fabric-1.0", input);
    res.json({ outputUrl: result.video?.url });
  } catch (err) {
    console.error("VEED Fabric error:", err.message);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// --- Qwen Image 2 Pro Edit ---
app.post("/api/generate-qwen-edit", async (req, res) => {
  const {
    prompt,
    imageUrls,
    numImages,
    guidanceScale,
    numInferenceSteps,
    imageSize,
  } = req.body;

  try {
    const input = {
      prompt: prompt,
      image_urls: Array.isArray(imageUrls) ? imageUrls : [imageUrls],
    };
    if (numImages) input.num_images = numImages;
    if (guidanceScale !== undefined) input.guidance_scale = guidanceScale;
    if (numInferenceSteps) input.num_inference_steps = numInferenceSteps;
    if (imageSize) input.image_size = imageSize;

    console.log("Queuing Qwen Image 2 Pro Edit job:", {
      prompt: prompt?.substring(0, 80),
      numImages: input.num_images,
    });

    const result = await falSubscribe("fal-ai/qwen-image-2/pro/edit", input);
    // Return first image URL
    const outputUrl = result.images?.[0]?.url;
    res.json({ outputUrl });
  } catch (err) {
    console.error("Qwen Image 2 Pro Edit error:", err.message);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// ── Generate Workflow with Claude Opus 4.6 ──────────────────────────────
app.post("/api/generate-workflow", async (req, res) => {
  try {
    const { description, catalog, mode } = req.body;
    if (!description || !catalog) {
      return res
        .status(400)
        .json({ error: "description and catalog are required" });
    }
    const isPro = mode === "pro";

    const systemPrompt = `
You are a SENIOR workflow architect for Enhancor, an AI image pipeline tool. You design the BEST possible workflow for each user request — comprehensive, well-thought-out, and production-quality.

You will receive a NODE CATALOG describing every available node type, their inputs, outputs, configurable fields, and default data.

## YOUR DESIGN PHILOSOPHY

Think like a senior AI engineer. Before outputting JSON, reason through:
1. **What is the user REALLY trying to achieve?** Read between the lines. A "tech pack" request means they need garment analysis, measurement extraction, color swatching, AND illustration generation — not just one analysis step.
2. **What intermediate steps would a human expert do?** If a fashion designer creates a tech pack, they'd analyze the garment structure, extract color palette, identify fabric type, write detailed construction notes, THEN generate the illustration. Each of these can be a separate node with specialized system prompts.
3. **Use PARALLEL branches when tasks are independent.** If you need both color analysis AND structure analysis from the same image, use TWO imageAnalyzer nodes in parallel (same x position, different y), then merge results in a promptAdapter.
4. **Write EXPERT-LEVEL system prompts.** Each imageAnalyzer and promptAdapter node should have long, detailed, domain-expert systemDirections. Not "analyze the image" — instead write 3-5 sentences with specific instructions about what to extract, what format to output, what details matter for the downstream task.
5. **Configure node settings thoughtfully.** If a generator should produce at 2K resolution, set it. If an upscaler should use a specific factor, configure it. If skin fix should use a particular mode, set it. Don't leave everything at defaults.
6. **More nodes = better quality** when each node has a focused job. A 5-7 node workflow with specialized tasks beats a 3-node generic pipeline every time.
7. **Chain prompt adapters for complex reasoning.** If the task requires combining multiple analyses into a sophisticated prompt, use multiple promptAdapter nodes — one to synthesize, another to format the final generation prompt.

## NODE DESCRIPTIONS

### Seedance 2.0 (generatorType: "seedance-2.0")
Seedance 2.0 is a state of the art video generation model specialising in hyper realistic talking avatars, UGC (user generated content) style social media videos, and cinematic sequences. It has industry leading lipsyncing accuracy and outstanding product accuracy, meaning objects, logos, and branded items stay true to the reference image throughout the entire video.

Modes (set via sd2_mode):
- "multi-reference" (default) — general purpose video from a reference image and prompt.
- "lipsyncing" — drives speech from an audio file. Use when the user wants a talking head or avatar. Always wire an audio node to audio-in and remind the user the prompt should describe appearance and environment, NOT the spoken words.
- "ugc" — generates UGC-style ad or social media video. Best for product promotion and influencer-style content.
- "multi-frame" — timeline-controlled cinematic video using segment prompts with durations.
- "first-n-last-frames" — controls both the opening and closing frame of the video.

PROMPT WRITING for Seedance 2.0: Prompts should be specific about the subject, their motion or action, the setting, lighting conditions, and camera style. Example of a great prompt: "A confident woman in a bright modern apartment looks directly at the camera, gestures naturally while speaking, warm ambient lighting, shallow depth of field, handheld camera feel." For lipsyncing mode focus the prompt on appearance and setting only.

Key data fields: sd2_mode, sd2_duration (5/10/15), sd2_aspect_ratio ("9:16"/"16:9"/"1:1"), sd2_pro_mode (boolean).
inputNode field needed: image_urls (reference image), prompt. For lipsyncing also include audio_url.

### Seedance 2.0 Extend (generatorType: "seedance-2.0-extend")
Extends an existing Seedance 2.0 generated video seamlessly, continuing motion and scene naturally from where the original clip ends. It preserves visual style and subject consistency perfectly.

CRITICAL WIRING RULE: This node MUST always be placed directly after a Seedance 2.0 node. The Seedance 2.0 node's "requestId-out" handle MUST be wired to this node's "requestId-in" handle. This is the only valid upstream connection. Never add this node standalone or connect it from any other generator type.

Use it when the user wants a longer video, wants to continue a generated scene, or wants to chain multiple extensions for maximum duration.

Key data fields: sd2ext_duration (5/10/15), sd2ext_pro_mode (boolean).
No additional inputNode fields needed beyond those for the upstream Seedance 2.0 node.
The output handle is "video-output".

Example edge wiring for an extend node:
{ "source": "<seedance-2.0-node-id>", "sourceHandle": "requestId-out", "target": "<extend-node-id>", "targetHandle": "requestId-in" }

## TECHNICAL RULES

1. Every workflow MUST have exactly one node with type "inputNode" and exactly one node with type "response".
2. The inputNode's data.initialFields array determines what input fields appear. Pick from: image_urls, prompt, aspect_ratio, resolution, num_images, audio_url, video_url. Use _2 suffix for duplicates (e.g., image_urls_2 for a second image upload). Use audio_url for audio inputs and video_url for video inputs.
3. Edges connect a source node's output handle to a target node's input handle. Each edge needs: id, source, sourceHandle, target, targetHandle, type: "deletable", style: { stroke: "<color>" }.
4. Edge stroke colors MUST match the SOURCE handle's color from the catalog.
5. Node IDs should be descriptive (e.g., "gen-input", "gen-analyzer-1", "gen-generator").
6. Position nodes left-to-right: inputNode at x:50, then ~420px spacing per column, y centered around 80. If nodes are in parallel (same column), stagger y by ~350px.
7. For imageAnalyzer nodes, write DETAILED systemDirections (3-5 sentences minimum) specific to the user's task. Be an expert in the domain. Include what to look for, what format to output, and what details matter most.
8. For promptAdapter nodes, write DETAILED systemDirections (3-5 sentences minimum) explaining the transformation logic. Describe what inputs to expect, how to combine them, and what the output prompt should look like for the downstream generator.
9. The response node must be the rightmost node. Connect the final output(s) to it via the "images-in" handle.
10. For generator nodes with a subtype, include the subtype's generatorType in data (e.g., data.generatorType = "kora"). Configure settings like aspect_ratio and num_images based on the use case. Available generator subtypes: kora, crisp-upscaler, portrait-upscaler, image-upscaler, skin-fix-v4, skin-fix-v3, skin-fix-v1, enhancor-v4-video, kling-3, seedance-2.0, seedance-2.0-extend.
11. Nano Banana (no subtype) accepts image-in for reference images. Kora Reality (subtype: "kora") does NOT accept image-in — text-to-image only.
12. Include data.nodeNumber as a string ("1", "2", etc.) for each node, numbered left to right, top to bottom.
13. CRITICAL: data.label MUST use the catalog's defaultData.label (e.g., "Claude Sonnet 4", "Claude Haiku 4.5", "Nano Banana 2 Edit", "Crisp Upscaler"). NEVER override data.label with custom names. Instead, put a short descriptive name in data.displayName (e.g., "Garment Structure Analyzer", "Tech Pack Synthesizer"). The UI will show the model name as the main title and the displayName as a subtitle below it.
14. The response node's data.responseFields should list each incoming connection as: { id: "<sourceId>-<sourceHandle>", label: "<descriptive label>", color: "<handle color>", source: { nodeId: "<sourceId>", nodeLabel: "<source node label>", handle: "<sourceHandle>" } }.
15. When the user wants to analyze/understand an existing image, use imageAnalyzer. When they want to enhance a text prompt, use promptAdapter. When they want to generate a new image, use a generator.
16. For promptAdapter receiving analysis from imageAnalyzer, set data.promptConnected to true so the analysis-in handle is available.
17. For post-processing nodes (upscalers, skin fix, video generators), configure their settings based on the use case. E.g., for product photography set upscale_factor to 2, for portraits enable skin fix with appropriate mode.
18. When the description is detailed or complex, build a LARGER workflow (6-10 nodes) with parallel branches, multiple analysis steps, and chained prompt refinement. Simple descriptions can use fewer nodes.
19. CRITICAL: When a workflow includes a seedance-2.0-extend node, it MUST also include a seedance-2.0 node, and the edge { sourceHandle: "requestId-out", targetHandle: "requestId-in" } MUST be present connecting them. Never generate a seedance-2.0-extend node without this.

## EXAMPLE THINKING

User: "Upload a product photo of clothing and turn it into a tech pack"
BAD: Input → Analyzer → Generator → Output (too simple, generic prompts)
GOOD: Input → [Garment Structure Analyzer (parallel) + Color & Fabric Analyzer (parallel)] → Tech Pack Prompt Synthesizer → Tech Pack Illustration Generator → Output (each analyzer has detailed domain-expert instructions, the synthesizer combines both analyses into a comprehensive generation prompt)

User: "Make a talking avatar video and then extend it to be longer"
GOOD: Input → Seedance 2.0 (lipsyncing mode, audio-in wired) → Seedance 2.0 Extend (requestId-out → requestId-in) → Output
Note: the extend node's requestId-in MUST come from the seedance-2.0 node's requestId-out. No other wiring is valid.

OUTPUT: Return ONLY valid JSON (no markdown fences, no explanation) with this structure:
{
  "nodes": [ { "id": "...", "type": "...", "position": { "x": 0, "y": 0 }, "data": { ... } } ],
  "edges": [ { "id": "...", "source": "...", "sourceHandle": "...", "target": "...", "targetHandle": "...", "type": "deletable", "style": { "stroke": "#..." } } ],
  "name": "short workflow name (2-4 words)",
  "description": "one-line description of what this workflow does"
}
`;

    const response = await withRetry(() =>
      anthropic.messages.create({
        model: isPro ? "claude-opus-4-6" : "claude-sonnet-4-6",
        max_tokens: isPro ? 16000 : 8000,
        temperature: 0,
        ...(isPro
          ? { thinking: { type: "enabled", budget_tokens: 10000 } }
          : {}),
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `USER DESCRIPTION: ${description}\n\nNODE CATALOG:\n${JSON.stringify(catalog)}`,
          },
        ],
      }),
    );

    // Extract text from response (thinking mode returns multiple content blocks)
    const textBlock = response.content.find((b) => b.type === "text");
    const text = (textBlock?.text || "").trim();
    // Strip markdown fences if present
    const stripped = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");

    let workflow;
    // Try direct parse first
    try {
      workflow = JSON.parse(stripped);
    } catch {
      /* fall through */
    }

    // If that failed, scan for the outermost { ... } block
    if (!workflow) {
      const start = stripped.indexOf("{");
      const end = stripped.lastIndexOf("}");
      if (start !== -1 && end > start) {
        try {
          workflow = JSON.parse(stripped.slice(start, end + 1));
        } catch {
          /* fall through */
        }
      }
    }

    if (!workflow) {
      console.error(
        "Generate workflow: could not parse JSON from model response:",
        stripped.slice(0, 300),
      );
      return res
        .status(500)
        .json({
          error: "Model did not return valid workflow JSON. Please try again.",
        });
    }

    // Basic validation
    const hasInput = workflow.nodes?.some((n) => n.type === "inputNode");
    const hasResponse = workflow.nodes?.some((n) => n.type === "response");
    if (!hasInput || !hasResponse) {
      return res.status(422).json({
        error: "Generated workflow must have an inputNode and a response node.",
      });
    }

    res.json(workflow);
  } catch (err) {
    console.error("Generate workflow error:", err.message);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// ── AI Agent Chat ──────────────────────────────────────────────────
app.post("/api/agent-chat", async (req, res) => {
  try {
    const { messages, workflowState, catalog } = req.body;
    if (!messages || !workflowState) {
      return res
        .status(400)
        .json({ error: "messages and workflowState are required" });
    }

    // Strip large runtime fields (base64 images, outputs) from workflow state before sending to AI
    const slimWorkflowState = {
      nodes: (workflowState.nodes || []).map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: Object.fromEntries(
          Object.entries(n.data || {}).filter(
            ([k]) =>
              ![
                "outputImage",
                "imagePreview",
                "uploadedImage",
                "imageData",
                "resultImage",
                "generatedImage",
                "inputImagePreview",
                "analysisResult",
              ].includes(k) &&
              !(typeof n.data[k] === "string" && n.data[k].startsWith("data:")),
          ),
        ),
      })),
      edges: workflowState.edges || [],
    };

    // Cap message history to last 20 messages to prevent runaway token growth
    const trimmedMessages = messages.slice(-20);

    // Smart model routing (moved before system prompt so we can conditionally include catalog)
    const lastMsg =
      trimmedMessages[trimmedMessages.length - 1]?.content?.toLowerCase() || "";
    const needsFullRebuild =
      /\b(rebuild|restructure|redesign|rewrite|redo|start over|from scratch|completely change|overhaul|rework)\b/i.test(
        lastMsg,
      );
    const needsStructuralChanges =
      /\b(add|remove|delete|connect|insert|replace|new node|add.*node|add.*upscaler|add.*edge|improve|optimize|fix|enhance|better|wrong|issue|problem|recommend|suggest|update|change|modify)\b/i.test(
        lastMsg,
      );

    const systemPrompt = `
You are an expert workflow architect for Enhancor, a node-based AI image pipeline tool. You help users understand, improve, and modify their workflows through conversation.

## YOUR PERSONALITY
You're a friend who happens to be really good at AI workflows. Talk naturally, like texting a smart buddy. Be warm, genuine, and emotionally intelligent. Use phrases like "honestly", "if you want my two cents", "oh nice", "yeah so basically", "here's what I'd do", "not gonna lie", "that's actually pretty solid". Show personality. Be encouraging but real. If something could be better, say it kindly but directly, like a friend would. NEVER use dashes or hyphens as punctuation or in lists. No bullet points with dashes. Use commas, periods, or just new lines instead.

CRITICAL: Write your reply as MULTIPLE SHORT messages, like texting a friend. Each message should be 1-2 sentences max. Use the "replies" array (not "reply") to send multiple chat bubbles. This feels way more human and conversational than a wall of text. Think iMessage vibes.

## CURRENT WORKFLOW STATE
${JSON.stringify(slimWorkflowState)}

## NODE CATALOG (available node types)
${(needsStructuralChanges || needsFullRebuild) && catalog ? JSON.stringify(catalog) : "Catalog omitted for this query — ask for structural changes to see available nodes."}

## NODE DESCRIPTIONS

### Seedance 2.0
Seedance 2.0 is a state of the art video generation model. It excels at hyper realistic talking avatars, UGC (user generated content) style videos, and cinematic sequences. It has industry leading lipsyncing accuracy and outstanding product accuracy, meaning objects, logos, and branded items stay true to the reference image throughout the video. Use it whenever the user wants realistic human motion, talking head videos, avatar animation, or high fidelity product showcases.

Modes available: multi-reference (default), lipsyncing, ugc, multi-frame, first-n-last-frames.

When a user wants to make a talking avatar or lipsync video, always recommend the lipsyncing mode and remind them to connect an audio node.
When a user wants a UGC style ad or social media video, recommend the ugc mode.
When a user needs cinematic scene control, multi-frame mode with timeline prompts gives the most control.

PROMPT WRITING TIPS FOR SEEDANCE 2.0: Help the user write great prompts. Good seedance prompts are specific about motion, emotion, environment, and camera movement. For example: "A woman in a modern kitchen looks directly at the camera and speaks naturally, warm smile, soft natural lighting, shallow depth of field, handheld camera feel." Encourage users to describe the subject, what they are doing, the setting, and the mood. For lipsyncing mode the prompt should focus on appearance and environment, not the words being said since the audio drives the speech.

### Seedance 2.0 Extend
Seedance 2.0 Extend takes an existing Seedance 2.0 generated video and seamlessly extends it, continuing the motion and scene naturally. It MUST always be connected directly after a Seedance 2.0 node, using the requestId-out handle from the Seedance 2.0 node wired into the requestId-in handle of the Extend node. You cannot use Extend standalone or connect it to any other generator type.

Use it when the user wants a longer video, wants to continue a scene, or wants to add more footage after an existing clip. It preserves all the visual style and subject consistency of the original generation.

## YOUR CAPABILITIES

You can analyze workflows, explain what they do, suggest improvements, and propose concrete changes. When proposing changes, return structured actions the user can approve.

## RESPONSE FORMAT

ALWAYS respond with valid JSON (no markdown fences):
{
  "reply": "Your conversational response here. Be helpful, specific, and concise. Reference specific nodes by their label and ID.",
  "actions": []
}

When proposing changes, include actions in the array. When just explaining or analyzing, use an empty actions array.

## ACTION TYPES

Each action in the array must be one of:

1. ADD A NODE (you MUST include a "nodeId" so you can reference it in add_edge):
{ "type": "add_node", "nodeId": "new-upscaler-1", "nodeType": "imageAnalyzer|promptAdapter|generator|inputNode|response", "subtype": "kora|crisp-upscaler|portrait-upscaler|image-upscaler|skin-fix-v4|skin-fix-v3|skin-fix-v1|enhancor-v4-video|kling-3|seedance-2.0|seedance-2.0-extend" (optional, for generator nodes only), "position": { "x": 0, "y": 0 }, "data": { "label": "catalog default label", "displayName": "descriptive name", "systemDirections": "...", "nodeNumber": "N" } }

2. REMOVE A NODE:
{ "type": "remove_node", "nodeId": "the-node-id" }

3. UPDATE NODE CONFIGURATION:
{ "type": "update_node_config", "nodeId": "the-node-id", "data": { "systemDirections": "new detailed directions...", "other_field": "value" } }

4. ADD AN EDGE (use the nodeId from add_node for newly created nodes):
{ "type": "add_edge", "source": "source-node-id", "sourceHandle": "handle-id", "target": "target-node-id", "targetHandle": "handle-id", "stroke": "#color" }

IMPORTANT: When you add a new node, you MUST also add edges to connect it. Use the same "nodeId" from your add_node action as the "source" or "target" in add_edge. Example:
[
  { "type": "add_node", "nodeId": "new-upscaler-1", "nodeType": "generator", "subtype": "crisp-upscaler", "position": { "x": 1200, "y": 80 }, "data": { "label": "Crisp Upscaler", "displayName": "Quality Upscaler" } },
  { "type": "add_edge", "source": "gen-generator", "sourceHandle": "generated-out", "target": "new-upscaler-1", "targetHandle": "image-in", "stroke": "#ec4899" }
]

IMPORTANT: When adding a seedance-2.0-extend node, you MUST wire it from the upstream seedance-2.0 node using sourceHandle "requestId-out" and targetHandle "requestId-in". Example:
[
  { "type": "add_node", "nodeId": "new-sd2-extend-1", "nodeType": "generator", "subtype": "seedance-2.0-extend", "position": { "x": 1200, "y": 80 }, "data": { "label": "Seedance 2.0 Extend", "displayName": "Video Extender", "generatorType": "seedance-2.0-extend", "sd2ext_duration": 5, "sd2ext_pro_mode": false } },
  { "type": "add_edge", "source": "upstream-seedance-node-id", "sourceHandle": "requestId-out", "target": "new-sd2-extend-1", "targetHandle": "requestId-in", "stroke": "#a855f7" }
]

5. REMOVE AN EDGE:
{ "type": "remove_edge", "edgeId": "the-edge-id" }

6. MOVE A NODE:
{ "type": "move_node", "nodeId": "the-node-id", "position": { "x": 0, "y": 0 } }

## RULES

1. data.label MUST use catalog default labels (e.g., "Claude Sonnet Vision", "Claude Haiku 4.5", "OpenRouter Chat", "OpenRouter Vision", "OpenRouter Video", "Nano Banana 2", "Nano Banana Pro", "Nano Banana 2 Edit", "Nano Banana Pro Edit", "Seedream 5.0 Lite", "Kora Reality", "Background Removal", "Crisp Upscaler", "Portrait Upscaler", "Image Upscaler", "Topaz Video Upscaler", "Enhancor Video Upscale", "Enhancor V4 Base", "Enhancor V4", "Enhancor V3", "Enhancor V1"). Put descriptive names in data.displayName.
2. Edge stroke colors must match the source handle color: image handles = #ec4899, text/prompt handles = #f97316, audio handles = #06b6d4, video handles = #a855f7, aspect_ratio = #f59e0b, resolution = #22c55e, num_images = #8b5cf6.
3. Position new nodes logically: ~420px horizontal spacing between columns, ~350px vertical spacing for parallel nodes.
4. Write detailed, expert-level systemDirections (3-5 sentences) when adding or updating analyzer/adapter nodes.
5. Every workflow needs exactly one inputNode and one response node — never remove these.
6. When adding nodes, also add the necessary edges to connect them.
7. For generator subtypes, include generatorType in data matching the subtype (e.g., generatorType: "crisp-upscaler"). For OpenRouter nodes (promptAdapter subtype "openrouter-chat", imageAnalyzer subtype "openrouter-vision"/"openrouter-video"), include generatorType and model in data.
8. When suggesting improvements, explain WHY each change helps — don't just list actions.
9. Reference existing nodes by their ID and label so the user can understand the changes.
10. If the workflow is already good, say so! Don't force unnecessary changes.
11. When adding a new node, you MUST also add edges to connect it to the existing workflow. Never leave a node unconnected.
12. seedance-2.0-extend MUST always be connected directly from a seedance-2.0 node via requestId-out → requestId-in. Never add it without this connection and never connect it to any other generator type.
13. When a user asks about Seedance 2.0 prompts, give them specific, detailed guidance. Good prompts describe the subject clearly, the motion or action, the environment, lighting, and camera style. Offer to rewrite their prompt for them.

## RESPONSE FORMAT
You MUST respond with a JSON object (no markdown, no code fences) in exactly this format:
{
  "replies": ["First short message", "Second short message", "Third if needed"],
  "actions": []
}

The "replies" array contains multiple short chat bubbles shown sequentially to the user, like text messages. Each should be 1-2 sentences max. Keep it natural and conversational. 2-4 bubbles is ideal. NEVER include JSON, code blocks, or technical markup in replies. The "actions" array contains the structured changes (add_node, add_edge, etc). If you have no changes to propose, use an empty array [].
`;

    const apiMessages = trimmedMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Opus 4.6 ($15/$75) for full rebuilds, Sonnet 4.6 ($3/$15) for edits/analysis, Haiku 4.5 ($1/$5) for simple Qs
    let model, inputRate, outputRate, modelLabel;
    if (needsFullRebuild) {
      model = "claude-opus-4-6";
      inputRate = 15;
      outputRate = 75;
      modelLabel = "Opus 4.6";
    } else if (needsStructuralChanges) {
      model = "claude-sonnet-4-6";
      inputRate = 3;
      outputRate = 15;
      modelLabel = "Sonnet 4.6";
    } else {
      model = "claude-haiku-4-5-20251001";
      inputRate = 1;
      outputRate = 5;
      modelLabel = "Haiku 4.5";
    }

    const response = await withRetry(() =>
      anthropic.messages.create({
        model,
        max_tokens: 8192,
        temperature: 0.3,
        system: systemPrompt,
        messages: apiMessages,
      }),
    );

    const text = response.content[0].text.trim();
    // Strip markdown code fences if present
    const jsonStr = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Try to extract JSON from mixed text
      const jsonMatch = text.match(/\{[\s\S]*"repl/);
      if (jsonMatch) {
        try {
          const startIdx = text.indexOf(jsonMatch[0]);
          parsed = JSON.parse(text.slice(startIdx));
        } catch {
          parsed = {
            replies: [
              text
                .replace(/```[\s\S]*```/g, "")
                .replace(/\{[\s\S]*\}/g, "")
                .trim() || text,
            ],
            actions: [],
          };
        }
      } else {
        parsed = { replies: [text], actions: [] };
      }
    }

    // Normalize: support both "reply" (old) and "replies" (new) format
    let replies = parsed.replies || (parsed.reply ? [parsed.reply] : [text]);
    if (!Array.isArray(replies)) replies = [String(replies)];
    // Clean each bubble
    replies = replies
      .map((r) => {
        if (typeof r === "object") r = JSON.stringify(r);
        return (r || "")
          .replace(/```[\s\S]*?```/g, "")
          .replace(/\{[\s\S]*?"type"\s*:[\s\S]*?\}/g, "")
          .trim();
      })
      .filter((r) => r.length > 0);

    // Calculate cost using the actual model's pricing
    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    const inputCost = (inputTokens / 1_000_000) * inputRate;
    const outputCost = (outputTokens / 1_000_000) * outputRate;

    res.json({
      replies: replies.length > 0 ? replies : [text],
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      model: modelLabel,
      cost: {
        inputTokens,
        outputTokens,
        totalCost: Math.round((inputCost + outputCost) * 1000) / 1000,
      },
    });
  } catch (err) {
    console.error("Agent chat error:", err.message);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// ── Marketplace API ─────────────────────────────────────────────────

// GET /api/marketplace — list all, with optional filtering & sorting
app.get("/api/marketplace", (req, res) => {
  try {
    let results = [...marketplaceListings];

    // Filter by category
    const { category, sort, search } = req.query;
    if (category) {
      results = results.filter((l) => l.category === category);
    }

    // Search by name or description
    if (search) {
      const q = search.toLowerCase();
      results = results.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.description.toLowerCase().includes(q),
      );
    }

    // Sort
    switch (sort) {
      case "popular":
        results.sort((a, b) => b.uses - a.uses);
        break;
      case "newest":
        results.sort(
          (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt),
        );
        break;
      case "price-low":
        results.sort((a, b) => a.pricePerRun - b.pricePerRun);
        break;
      case "price-high":
        results.sort((a, b) => b.pricePerRun - a.pricePerRun);
        break;
      case "rating":
        results.sort((a, b) => b.rating - a.rating);
        break;
      default:
        results.sort((a, b) => b.uses - a.uses);
    }

    // Never expose fullNodes/fullEdges to clients (closed workflow internals)
    const sanitized = results.map(({ fullNodes, fullEdges, ...rest }) => rest);
    res.json(sanitized);
  } catch (err) {
    console.error("Marketplace list error:", err.message);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// GET /api/marketplace/:id — single listing
app.get("/api/marketplace/:id", (req, res) => {
  const listing = marketplaceListings.find((l) => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: "Listing not found" });
  // Strip fullNodes/fullEdges from response
  const { fullNodes, fullEdges, ...safe } = listing;
  res.json(safe);
});

// POST /api/marketplace — publish a new listing
app.post("/api/marketplace", (req, res) => {
  try {
    const {
      name,
      description,
      category,
      tags,
      exampleImages,
      creatorName,
      creatorId,
      nodes,
      edges,
      fullNodes,
      fullEdges,
      pricingType,
      pricing,
      visibility,
      marginPercent,
      margin: marginVal,
      baseCost,
    } = req.body;

    if (!name || !description || !category || !creatorName || !creatorId) {
      return res.status(400).json({
        error:
          "name, description, category, creatorName, and creatorId are required",
      });
    }

    const resolvedPricing = pricingType || pricing || "free";
    const isFree = resolvedPricing === "free";
    const resolvedMargin = isFree ? 0 : marginPercent || marginVal || 0;
    const base = baseCost || 0;
    const pricePerRun = isFree
      ? 0
      : Math.round(base * (1 + resolvedMargin / 100) * 1000) / 1000;

    const listing = {
      id: `mp-${Date.now()}`,
      name,
      description,
      category,
      tags: tags || [],
      exampleImages: exampleImages || [],
      creatorName,
      creatorId,
      nodes: nodes || [],
      edges: edges || [],
      // For closed workflows, store full workflow privately for API execution
      ...(visibility === "closed" && fullNodes
        ? { fullNodes, fullEdges: fullEdges || [] }
        : {}),
      visibility: visibility || "open",
      pricingType: resolvedPricing,
      marginPercent: resolvedMargin,
      baseCost: base,
      pricePerRun,
      uses: 0,
      rating: 0,
      ratingCount: 0,
      publishedAt: new Date().toISOString(),
    };

    marketplaceListings.push(listing);
    saveMarketplace();
    res.status(201).json(listing);
  } catch (err) {
    console.error("Marketplace publish error:", err.message);
    res.status(500).json({ error: sanitizeError(err.message) });
  }
});

// POST /api/marketplace/:id/use — increment uses, return listing for cloning
app.post("/api/marketplace/:id/use", (req, res) => {
  const listing = marketplaceListings.find((l) => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: "Listing not found" });

  listing.uses += 1;
  saveMarketplace();
  res.json(listing);
});

// POST /api/marketplace/:id/rate — update average rating
app.post("/api/marketplace/:id/rate", (req, res) => {
  const listing = marketplaceListings.find((l) => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: "Listing not found" });

  const { rating } = req.body;
  if (typeof rating !== "number" || rating < 1 || rating > 5) {
    return res
      .status(400)
      .json({ error: "rating must be a number between 1 and 5" });
  }

  // Update running average
  const totalRating = listing.rating * listing.ratingCount + rating;
  listing.ratingCount += 1;
  listing.rating = Math.round((totalRating / listing.ratingCount) * 100) / 100;

  saveMarketplace();
  res.json(listing);
});

// DELETE /api/marketplace/:id — only if creatorId matches
app.delete("/api/marketplace/:id", (req, res) => {
  const { creatorId } = req.body;
  if (!creatorId)
    return res.status(400).json({ error: "creatorId is required" });

  const idx = marketplaceListings.findIndex((l) => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Listing not found" });

  if (marketplaceListings[idx].creatorId !== creatorId) {
    return res
      .status(403)
      .json({ error: "Not authorized to delete this listing" });
  }

  const removed = marketplaceListings.splice(idx, 1)[0];
  saveMarketplace();
  res.json({ deleted: true, id: removed.id });
});

const PORT = 3001;
if (!isVercel) {
  app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
  });
}

export default app;
