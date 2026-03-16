# Prompt Enhancer Workflow — Build from Scratch

## What it does
The simplest workflow. User types a prompt and optionally uploads an image. If the "Enhance" toggle is on, the prompt gets enhanced by Claude Haiku before generation. The image gets generated via Nano Banana.

## The pipeline
```
Without enhance:
[Input] → [Generator]

With enhance:
[Input] → [Prompt Adapter] → [Adapted Prompt] → [Generator]
```

## Build instructions

Build a "Prompt Enhancer" workflow in a React + Vite node-based editor using @xyflow/react. Express.js backend on port 3001. This workflow dynamically changes based on an "Enhance" toggle.

### Without Enhance (2 nodes)

#### Node 1: User Input
- Custom node type `inputNode`
- Fields: image upload (drag-and-drop with preview), prompt textarea
- No aspect ratio or resolution fields shown by default (use defaults: 1:1, 2K)
- Output handles: `image`, `prompt`

#### Node 2: Generator (Nano Banana 2)
- Custom node type `generator`
- Receives image on `image-in` and prompt on `prompt-in`
- Shows the input prompt, image preview, and generated output
- Badge: "Nano Banana API"

#### Edges
- Input image → Generator image-in (pink)
- Input prompt → Generator prompt-in (indigo)

### With Enhance (4 nodes)

#### Node 1: User Input (same as above)

#### Node 2: Prompt Adapter (Claude Haiku)
- Custom node type `promptAdapter`
- Receives user prompt on `prompt-in`
- Has editable system directions textarea: "You are a creative prompt engineer. Take the user's prompt and enhance it to be more detailed and descriptive for image generation. Keep the core intent but add artistic details, style, lighting, and composition guidance."
- "View Full Directions" button opens modal
- Output handle: `adapted-prompt`
- Backend: `POST /api/adapt-prompt` with `{ userPrompt, systemDirections }`. Uses Claude Haiku.

#### Node 3: Adapted Prompt (display node)
- Custom node type `adaptedPrompt`
- Simple node that displays the enhanced prompt text
- Input handle: `adapted-in`, Output handle: `prompt-out`

#### Node 4: Generator (same as above, but positioned further right)
- Receives the enhanced prompt from Node 3 instead of the raw prompt from Node 1

#### Edges (with enhance)
- Input prompt → Adapter prompt-in (indigo)
- Adapter adapted-prompt → Adapted prompt adapted-in (purple)
- Input image → Generator image-in (pink)
- Adapted prompt prompt-out → Generator prompt-in (purple)

### Workflow runner logic
When the user clicks "Run Workflow":
1. Validate that a prompt is provided
2. If enhance is ON: Send prompt + system directions to `/api/adapt-prompt`. Update adapted prompt node.
3. If user uploaded an image: Upload via `/api/upload-image` (compress → catbox.moe → public URL)
4. Send (enhanced or original) prompt + image URL + resolution + aspect ratio to `/api/generate-image`. Update generator node.

### Dynamic layout
The node layout must change when the enhance toggle is flipped. When enhance turns on, insert the Prompt Adapter and Adapted Prompt nodes between Input and Generator, and move the Generator further right. When enhance turns off, remove those nodes and move the Generator back.

### Interface View
The Interface View for this workflow shows:
- Image upload zone (optional — for image-to-image editing)
- Prompt textarea with an "Enhance" toggle button inline next to the label
- When enhance is ON and the prompt has been enhanced, show the enhanced prompt in a separate section
- Aspect ratio pill buttons (1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3)
- Resolution pill buttons (1K, 2K, 4K)
- "Generate Image" button
- Output panel on the right showing the generated image
