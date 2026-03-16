# Clothes Cutout Workflow — Build from Scratch

## What it does
User uploads a photo of a person wearing clothing. The vision model analyzes the garment in detail — fabric, color, construction, fit. It then generates a prompt for a clean e-commerce product shot: just the clothing on an invisible mannequin against a white background. The generation API creates the product photo.

## The pipeline
```
[Input (image)] → [Clothing Analyzer] → [Generator] → [Response]
```

## Build instructions

Build a "Clothes Cutout" workflow with 4 nodes in a React + Vite node-based editor using @xyflow/react. Express.js backend on port 3001.

### Node 1: Request Input
- Custom node type `inputNode`
- Fields: image upload, aspect ratio selector, resolution selector (no prompt field needed — the system prompt handles everything)
- Output handles: `image`, `aspect-ratio`, `resolution`

### Node 2: Cutout Prompt Builder (Claude Sonnet Vision)
- Custom node type `imageAnalyzer`
- Receives image on `image-in` handle
- Badge: "Claude Vision"
- System prompt instructs Claude to:
  - Act as an expert e-commerce product photography prompt engineer
  - Analyze the person wearing clothing and extract every detail about the garments: style, color, fabric, texture, pattern, stitching, buttons, zippers, logos, fit, drape, layering
  - Generate a single image generation prompt that recreates ONLY the clothing as a product shot
  - Enforce: pure white background, ghost mannequin technique (no human body visible), professional studio lighting with soft diffused key light, crisp focus on fabric texture, slight shadow beneath for grounding
  - Output one cohesive paragraph under 800 characters, no commentary
- Shows image preview and the generated prompt text
- Output handle: `analysis-out`
- Backend: `POST /api/analyze-image` with `{ imageBase64, mediaType, systemPrompt }`

### Node 3: Generator (Nano Banana 2)
- Custom node type `generator`
- Receives: prompt from analyzer, image from input, aspect ratio, resolution
- Displays all inputs and the generated output
- Badge: "Nano Banana API"
- Output handle: `output`
- Backend: Upload image via `/api/upload-image` (compress → catbox.moe), then `/api/generate-image` with `{ prompt, imageUrl, resolution, aspectRatio }`. Queue-and-poll pattern.

### Node 4: Response
- Displays the final product shot

### Edges
- Input image → Analyzer image-in (green)
- Analyzer analysis-out → Generator prompt-in (purple)
- Input image → Generator image-in (pink) — the original image is also sent to the generator as reference
- Input aspect-ratio → Generator aspect-ratio-in (amber)
- Input resolution → Generator resolution-in (amber)
- Generator output → Response images-in (green)

### Workflow runner logic
When the user clicks "Run Workflow":
1. Validate that an image has been uploaded
2. **Step 1/3**: Send image + cutout system prompt to `/api/analyze-image`. Claude analyzes the clothing and outputs a product shot prompt. Update analyzer node.
3. **Step 2/3**: Upload the original image via `/api/upload-image`
4. **Step 3/3**: Send prompt + image URL + resolution + aspect ratio to `/api/generate-image`. Update generator and response nodes.

### Interface View
The Interface View for this workflow shows:
- Image upload zone (required — photo of someone wearing the clothing)
- Aspect ratio pill buttons
- Resolution pill buttons
- "Generate Cutout" button
- No prompt field — the system prompt handles everything
- Shows the "Generated Prompt" (the cutout description) below inputs after Step 1 completes
- Output panel on the right showing the product shot
