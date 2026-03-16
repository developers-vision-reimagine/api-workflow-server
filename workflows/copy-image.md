# Copy Image Workflow — Build from Scratch

## What it does
User uploads any photo. An AI vision model analyzes the image in detail, then a text-to-image model generates a similar-looking image from the description. Two-step workflow — the simplest one.

## The pipeline
```
[Input] → [Image Analyzer] → [Generator] → [Response]
```

## Build instructions

Build a "Copy Image" workflow with 4 nodes in a React + Vite node-based editor using @xyflow/react. Express.js backend on port 3001.

### Node 1: Request Input
- Custom React Flow node type `inputNode`
- Fields to show: image upload, aspect ratio selector, resolution selector
- Image upload with drag-and-drop and paste support. Show a thumbnail preview when an image is selected.
- Aspect ratio: pill buttons for 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3. Default 1:1.
- Resolution: pill buttons for 1K, 2K, 4K. Default 2K.
- Output handles on the right side: `image`, `aspect-ratio`, `resolution`

### Node 2: Image Analyzer (Claude Sonnet Vision)
- Custom node type `imageAnalyzer`
- Receives the image from Node 1 via the `image-in` handle on the left
- Shows the received image as a small preview
- Has a large system prompt textarea (editable) with a "View Full Directions" button that opens a modal for full editing
- The system prompt tells Claude to analyze the image and output a generation-ready prompt. It should include the `an1ta` LoRA token, describe the subject in precise detail (face, body, clothing, environment, lighting, composition), and output one paragraph under 1000 characters. The prompt must start with "amateur iphone photography with no blur background".
- Shows the analysis output text below
- Badge: "Claude Vision"
- Output handle: `analysis-out`
- Backend: `POST /api/analyze-image` — sends `{ imageBase64, mediaType, systemPrompt }` to Claude Sonnet (`claude-sonnet-4-20250514`). The image is sent as a base64 content block. Returns `{ analysis }`.

### Node 3: Generator (Kora Reality)
- Custom node type `generator`
- Receives the analysis text on `prompt-in` handle from Node 2
- Receives aspect ratio on `aspect-ratio-in` and resolution on `resolution-in` from Node 1
- Displays the prompt text (scrollable, max 80px height), aspect ratio value, resolution value
- Shows a "Generated Output" section with loading spinner during generation and the result image after
- Badge: "Kora Reality API"
- Output handle: `output`
- Backend: `POST /api/generate-kora` — Kora Reality is text-to-image only, no image upload needed. Takes `{ prompt, aspectRatio, resolution }`. Map aspect ratios: "1:1"→"square", "16:9"→"landscape16:9", "9:16"→"portrait9:16", "4:3"→"landscape4:3", "3:4"→"portrait3:4". Map resolutions: "1K"→"hd", "2K"→"2k", "4K"→"2k". Use queue-and-poll pattern: POST to `/queue` endpoint, get back `requestId`, then poll `/status` every 2 seconds until status is "COMPLETED". Returns `{ outputUrl }`.

### Node 4: Response
- Custom node type `response`
- Receives the generated image from Node 3 via `images-in` handle
- Displays the final generated image full-width
- Shows loading spinner while waiting

### Edges (connections between nodes)
- Input image → Analyzer image-in (green)
- Analyzer analysis-out → Generator prompt-in (purple)
- Input aspect-ratio → Generator aspect-ratio-in (amber)
- Input resolution → Generator resolution-in (amber)
- Generator output → Response images-in (green)

### Workflow runner logic
When the user clicks "Run Workflow":
1. Validate that an image has been uploaded
2. **Step 1/2**: Extract base64 from the image data URL. Validate the media type (must be jpeg, png, gif, or webp — fall back to jpeg for non-standard types like iPhone images). Send to `/api/analyze-image` with the system prompt. Update the analyzer node with the result.
3. **Step 2/2**: Send the analysis text as the prompt to `/api/generate-kora` with the selected aspect ratio and resolution. Update the generator and response nodes with the output image URL.
4. Show step-by-step status updates in the toolbar. Handle errors gracefully and reset loading states.

### Interface View
The Interface View for this workflow shows:
- Image upload zone (required — the image to recreate)
- Aspect ratio pill buttons
- Resolution pill buttons
- "Copy Image" button
- No prompt field — the vision model generates the prompt automatically
- Shows the "Generated Prompt" (the analysis output) below the inputs after Step 1 completes
- Output panel on the right showing the generated image

### Dark theme styling
- Background: #0a0a0f
- Node background: #1e1e2e with subtle border
- Node header: slightly lighter background with node number badge
- Handle labels next to each connection point
- Animated edges with colored strokes
- All text light gray/white
