# Virtual Try-On Workflow — Build from Scratch

## What it does
User uploads two images: a clothing item and a person (subject/model). Two vision models analyze each image in parallel — one describes the clothing in detail, the other describes the person. A combiner node merges both analyses into a single generation prompt. The generation API receives the master prompt plus BOTH original images to create a realistic photo of the person wearing the clothing.

## The pipeline
```
[Clothing Input] → [Clothing Analyzer] ──┐
                                          ├→ [Prompt Combiner] → [Generator] → [Response]
[Subject Input]  → [Subject Analyzer]  ──┘        ↑                  ↑
                                                   │                  │
                         both clothing + subject images also wire ────┘
```

## Build instructions

Build a "Virtual Try-On" workflow with 7 nodes in a React + Vite node-based editor using @xyflow/react. Express.js backend on port 3001.

### Node 1: Clothing Image Input
- Custom node type `inputNode`
- Fields: image upload only (no prompt, no aspect ratio, no resolution — the subject input handles those)
- Label: "Clothing Image"
- Positioned at top-left of the canvas
- Output handle: `image`

### Node 2: Subject / Model Input
- Custom node type `inputNode`
- Fields: image upload, aspect ratio selector, resolution selector
- Label: "Subject / Model"
- Positioned at bottom-left of the canvas
- Output handles: `image`, `aspect-ratio`, `resolution`

### Node 3: Clothing Analyzer (Claude Sonnet Vision)
- Custom node type `imageAnalyzer`
- Receives clothing image on `image-in`
- Badge: "Claude Vision"
- System prompt: Fashion analysis expert. Analyze the clothing image exhaustively — garment type, color, pattern, print, fabric type and texture, construction details (seams, stitching, buttons, zippers, pockets, collar, sleeves, hemline), fit characteristics, brand logos, layering. Output a structured description only — no prompt generation.
- Output handle: `analysis-out`

### Node 4: Subject Analyzer (Claude Sonnet Vision)
- Custom node type `imageAnalyzer`
- Receives subject image on `image-in`
- Badge: "Claude Vision"
- System prompt: Portrait and body analysis expert for virtual try-on. Analyze the person — gender presentation, age range, body type, proportions, skin tone, hair, facial features, pose, posture, background, current clothing (will be replaced), lighting. Output a structured description only — no prompt generation.
- Output handle: `analysis-out`

### Node 5: Try-On Prompt Builder (Claude Haiku)
- Custom node type `promptAdapter`
- Two input handles: `prompt-in` (receives clothing analysis from Node 3) and `analysis-in` (receives subject analysis from Node 4)
- System prompt: Virtual try-on prompt engineer. Receives two inputs — a clothing description and a subject description. Creates a single image generation prompt showing the EXACT same person wearing the EXACT clothing. Rules: maintain person's exact appearance (face, body, skin, hair, pose), render clothing naturally with realistic fit and drape, keep original background and lighting, result must look like a natural photograph not a composite. Output one paragraph under 1000 characters.
- Has "View Full Directions" button for modal editing
- Output handle: `adapted-prompt`
- Backend: `POST /api/adapt-prompt` — sends `{ userPrompt: "CLOTHING DESCRIPTION:\n...\n\nSUBJECT/MODEL DESCRIPTION:\n...", systemDirections }`. Uses Claude Haiku (`claude-haiku-4-5-20251001`).

### Node 6: Generator (Nano Banana 2)
- Custom node type `generator`
- Receives: master prompt from combiner on `prompt-in`, BOTH images on `image-in` (two edges connect to the same handle), aspect ratio and resolution from subject input
- **Must display multiple image thumbnails** — the generator node needs to support an `inputImagePreviews` array so it can show both the clothing and subject thumbnails side by side in the image_urls field
- Badge: "Nano Banana API"
- Output handle: `output`
- Backend: Upload BOTH images in parallel via `/api/upload-image`. Then `/api/generate-image` with `{ prompt, imageUrls: [clothingUrl, subjectUrl], resolution, aspectRatio }`. The `imageUrls` array maps to Nano Banana's `image_input` parameter.

### Node 7: Response
- Displays the final try-on result

### Edges (9 total)
- Clothing input image → Clothing analyzer image-in (green)
- Subject input image → Subject analyzer image-in (amber)
- Clothing analyzer analysis-out → Combiner prompt-in (green)
- Subject analyzer analysis-out → Combiner analysis-in (amber)
- Combiner adapted-prompt → Generator prompt-in (purple)
- Clothing input image → Generator image-in (green) — clothing image also goes directly to generator
- Subject input image → Generator image-in (pink) — subject image also goes directly to generator
- Subject aspect-ratio → Generator aspect-ratio-in (amber)
- Subject resolution → Generator resolution-in (amber)
- Generator output → Response images-in (green)

### Workflow runner logic
When the user clicks "Run Workflow":
1. Validate that BOTH images have been uploaded
2. **Step 1/4**: Analyze both images IN PARALLEL using `Promise.all`. Send clothing image + clothing system prompt to `/api/analyze-image`. Send subject image + subject system prompt to `/api/analyze-image`. Update both analyzer nodes.
3. **Step 2/4**: Combine both analyses. Format as `"CLOTHING DESCRIPTION:\n{clothesAnalysis}\n\nSUBJECT/MODEL DESCRIPTION:\n{subjectAnalysis}"`. Send to `/api/adapt-prompt` with the combiner's system directions. Update the generator node with the master prompt AND both image previews as an array.
4. **Step 3/4**: Upload BOTH images in parallel via `/api/upload-image`. Collect both public URLs.
5. **Step 4/4**: Send master prompt + both image URLs as `imageUrls` array + resolution + aspect ratio (default 3:4) to `/api/generate-image`. Update generator and response nodes.

### Important implementation details
- The two analyzers MUST run in parallel (`Promise.all`) for speed
- The two image uploads MUST also run in parallel
- The generator node must receive `inputImagePreviews: [clothesPreview, subjectPreview]` (array) instead of a single `inputImagePreview`
- The GeneratorNode component must check for `data.inputImagePreviews` array and render multiple thumbnails side by side, falling back to single `data.inputImagePreview` for other workflows
- Default aspect ratio for virtual try-on should be 3:4 (portrait)

### Interface View
The Interface View for this workflow shows:
- "Clothing Image" label + image upload zone (required — the clothing item)
- "Subject / Model" label + image upload zone (required — photo of the person)
- Aspect ratio pills (defaults to 3:4 portrait)
- Resolution pills
- "Generate Try-On" button
- Shows the "Generated Prompt" (the combined try-on prompt) below inputs after Step 2 completes
- Output panel on the right showing the try-on result
