# Mirror Selfie Workflow — Build from Scratch

## What it does
User uploads a photo of a person (e.g. an AI influencer) and writes a prompt describing the desired selfie scenario (role, setting, vibe). The vision model analyzes the person's appearance, then builds a detailed UGC mirror selfie template. The generation API creates a realistic iPhone mirror selfie of that person.

## The pipeline
```
[Input (image + prompt)] → [Image Analyzer] → [Generator] → [Response]
```

## Build instructions

Build a "Mirror Selfie" workflow with 4 nodes in a React + Vite node-based editor using @xyflow/react. Express.js backend on port 3001.

### Node 1: Request Input
- Custom node type `inputNode`
- Fields: image upload, prompt textarea, aspect ratio selector, resolution selector
- Image upload with drag-and-drop, preview thumbnail
- Prompt textarea for the user to describe the selfie scenario (e.g. "plus size model in a photography studio")
- Aspect ratio pills (1:1, 16:9, 9:16, etc.) and resolution pills (1K, 2K, 4K)
- Output handles: `image`, `prompt`, `aspect-ratio`, `resolution`

### Node 2: Mirror Selfie Builder (Claude Sonnet Vision)
- Custom node type `imageAnalyzer`
- Receives image on `image-in` handle AND user prompt on `prompt-in` handle
- Badge: "Claude Vision"
- Has a massive system prompt that acts as a UGC mirror selfie template generator. The system prompt must enforce these rules:
  - ALL outputs must be mirror selfies with the phone visible in the mirror reflection
  - No POV shots, no front camera selfies, no third person shots
  - The user prompt is the primary source of truth — never reinterpret or soften the intent
  - Extract body type from the input image (proportions, posture, how clothing fits). If user explicitly states body type like "plus size", use it verbatim
  - Lock the environment to whatever the user specifies. Never replace a stated setting with a generic one
  - Output a flat key-value template with fields: mirror_selfie, description, age, expression, hair, body type, body_details, posture, clothing, accessories, photo_style, camera_angle, framing, aspect_ratio, lighting, room_description, background, scene, phone
  - The description field must restate the user intent clearly with correct role, body type, and environment
  - Style must feel like a real mirror selfie — casual, imperfect, UGC aesthetic (Instagram Reels / TikTok)
- Shows image preview and output analysis text
- Output handle: `analysis-out`
- Backend: `POST /api/analyze-image` — sends `{ imageBase64, mediaType, systemPrompt, userPrompt }`. Both the system prompt AND user prompt are sent. Claude analyzes the image using the system prompt's rules and the user's intent.

### Node 3: Generator (Nano Banana 2)
- Custom node type `generator`
- Receives: prompt from analyzer, image from input, aspect ratio, resolution
- The aspect ratio should be locked/defaulted to 9:16 for selfie format
- Displays prompt, aspect ratio, image preview, resolution, and generated output
- Badge: "Nano Banana API"
- Output handle: `output`
- Backend: `POST /api/upload-image` first — compress with sharp (1024px max, JPEG 80), upload to catbox.moe for a public URL. Then `POST /api/generate-image` — sends `{ prompt, imageUrl, resolution, aspectRatio: "9:16" }`. Queue-and-poll: POST to /queue, poll /status every 2s until COMPLETED.

### Node 4: Response
- Custom node type `response`
- Displays the final mirror selfie image

### Edges
- Input image → Analyzer image-in (amber)
- Input prompt → Analyzer prompt-in (indigo)
- Analyzer analysis-out → Generator prompt-in (purple)
- Input image → Generator image-in (pink)
- Input aspect-ratio → Generator aspect-ratio-in (amber)
- Input resolution → Generator resolution-in (amber)
- Generator output → Response images-in (green)

### Workflow runner logic
When the user clicks "Run Workflow":
1. Validate that BOTH an image and a prompt are provided
2. **Step 1/3**: Send image + system prompt + user prompt to `/api/analyze-image`. Claude builds the mirror selfie template. Update analyzer node.
3. **Step 2/3**: Upload the original image via `/api/upload-image` (compress → catbox.moe → public URL)
4. **Step 3/3**: Send selfie template prompt + image URL to `/api/generate-image` with aspect ratio forced to 9:16. Update generator and response nodes.

### Interface View
The Interface View for this workflow shows:
- Image upload zone (required — photo of the person)
- "Describe the Selfie" prompt textarea with placeholder: "e.g. Plus size model in a photography studio, wearing casual streetwear..."
- Aspect ratio pills (defaults to 9:16)
- Resolution pills
- "Generate Selfie" button
- Shows the "Generated Prompt" (the mirror selfie template) below inputs after Step 1 completes
- Output panel on the right showing the generated selfie
