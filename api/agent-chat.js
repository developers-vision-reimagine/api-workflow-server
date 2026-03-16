import { getAnthropic, corsHeaders, handleOptions } from './_helpers.js';

export const config = {
  maxDuration: 120,
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return handleOptions(res);
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, workflowState, catalog } = req.body;
    if (!messages || !workflowState) {
      return res.status(400).json({ error: 'messages and workflowState are required' });
    }

    const systemPrompt = `You are an expert workflow architect for Enhancor, a node-based AI image pipeline tool. You help users understand, improve, and modify their workflows through conversation.

## YOUR PERSONALITY
You're a friend who happens to be really good at AI workflows. Talk naturally, like texting a smart buddy. Be warm, genuine, and emotionally intelligent. Use phrases like "honestly", "if you want my two cents", "oh nice", "yeah so basically", "here's what I'd do", "not gonna lie", "that's actually pretty solid". Show personality. Be encouraging but real. If something could be better, say it kindly but directly, like a friend would. Keep it short and conversational, no walls of text. NEVER use dashes or hyphens as punctuation or in lists. No bullet points with dashes. Use commas, periods, or just new lines instead.

## CURRENT WORKFLOW STATE
${JSON.stringify(workflowState, null, 2)}

## NODE CATALOG (available node types)
${catalog ? JSON.stringify(catalog, null, 2) : 'Not provided'}

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
{ "type": "add_node", "nodeId": "new-upscaler-1", "nodeType": "imageAnalyzer|promptAdapter|generator|inputNode|response", "subtype": "kora|crisp-upscaler|portrait-upscaler|image-upscaler|skin-fix-v4|skin-fix-v3|skin-fix-v1|enhancor-v4-video|kling-3" (optional, for generator nodes only), "position": { "x": 0, "y": 0 }, "data": { "label": "catalog default label", "displayName": "descriptive name", "systemDirections": "...", "nodeNumber": "N" } }

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

5. REMOVE AN EDGE:
{ "type": "remove_edge", "edgeId": "the-edge-id" }

6. MOVE A NODE:
{ "type": "move_node", "nodeId": "the-node-id", "position": { "x": 0, "y": 0 } }

## RULES

1. data.label MUST use catalog default labels (e.g., "Claude Sonnet 4", "Claude Haiku 4.5", "Nano Banana 2 Edit"). Put descriptive names in data.displayName.
2. Edge stroke colors must match the source handle color from the catalog.
3. Position new nodes logically: ~420px horizontal spacing between columns, ~350px vertical spacing for parallel nodes.
4. Write detailed, expert-level systemDirections (3-5 sentences) when adding or updating analyzer/adapter nodes.
5. Every workflow needs exactly one inputNode and one response node — never remove these.
6. When adding nodes, also add the necessary edges to connect them.
7. For generator subtypes, include generatorType in data.
8. When suggesting improvements, explain WHY each change helps — don't just list actions.
9. Reference existing nodes by their ID and label so the user can understand the changes.
10. If the workflow is already good, say so! Don't force unnecessary changes.
11. When adding a new node, you MUST also add edges to connect it to the existing workflow. Never leave a node unconnected.

## RESPONSE FORMAT
You MUST respond with a JSON object (no markdown, no code fences) in exactly this format:
{
  "reply": "Your friendly conversational message here. NEVER include JSON, code blocks, or technical markup in this field. Just plain text like you're texting a friend.",
  "actions": []
}

The "reply" field is shown directly to the user as a chat bubble. It must be plain, human-readable text only. The "actions" array contains the structured changes (add_node, add_edge, etc). If you have no changes to propose, use an empty array [].`;

    const apiMessages = messages.map(m => ({ role: m.role, content: m.content }));

    // Smart model routing
    const lastMsg = messages[messages.length - 1]?.content?.toLowerCase() || '';
    const needsFullRebuild = /\b(rebuild|restructure|redesign|rewrite|redo|start over|from scratch|completely change|overhaul|rework)\b/i.test(lastMsg);
    const needsStructuralChanges = /\b(add|remove|delete|connect|insert|replace|new node|add.*node|add.*upscaler|add.*edge|improve|optimize|fix|enhance|better|wrong|issue|problem|recommend|suggest|update|change|modify)\b/i.test(lastMsg);

    let model, inputRate, outputRate, modelLabel;
    if (needsFullRebuild) {
      model = 'claude-opus-4-20250918'; inputRate = 15; outputRate = 75; modelLabel = 'Opus 4';
    } else if (needsStructuralChanges) {
      model = 'claude-sonnet-4-20250514'; inputRate = 3; outputRate = 15; modelLabel = 'Sonnet 4';
    } else {
      model = 'claude-haiku-4-5-20251001'; inputRate = 1; outputRate = 5; modelLabel = 'Haiku 4.5';
    }

    const response = await getAnthropic().messages.create({
      model, max_tokens: 8192, temperature: 0.3,
      system: systemPrompt, messages: apiMessages,
    });

    const text = response.content[0].text.trim();
    const jsonStr = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*"reply"\s*:/);
      if (jsonMatch) {
        try {
          const startIdx = text.indexOf(jsonMatch[0]);
          parsed = JSON.parse(text.slice(startIdx));
        } catch {
          parsed = { reply: text.replace(/```[\s\S]*```/g, '').replace(/\{[\s\S]*\}/g, '').trim() || text, actions: [] };
        }
      } else {
        parsed = { reply: text, actions: [] };
      }
    }

    if (typeof parsed.reply === 'object') parsed.reply = JSON.stringify(parsed.reply);
    parsed.reply = (parsed.reply || text).replace(/```[\s\S]*?```/g, '').replace(/\{[\s\S]*?"type"\s*:[\s\S]*?\}/g, '').trim();

    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    const inputCost = (inputTokens / 1_000_000) * inputRate;
    const outputCost = (outputTokens / 1_000_000) * outputRate;

    res.json({
      reply: parsed.reply || text,
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      model: modelLabel,
      cost: { inputTokens, outputTokens, totalCost: Math.round((inputCost + outputCost) * 1000) / 1000 }
    });
  } catch (err) {
    console.error('Agent chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
