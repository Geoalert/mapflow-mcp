# Suggested MCP SDK Features for Mapflow MCP Server

This document outlines unused MCP SDK features that could enhance the Mapflow MCP server experience.

## Current Implementation

The server uses:
- **4 Tools**: `start-processing`, `get-processing`, `calculate-cost`, `get-geoboundary`
- **4 Resources**: `mapflow://models`, `mapflow://models/{modelName}/blocks`, `mapflow://limits`, `mapflow://imagery-sources`
- **SDK**: `@modelcontextprotocol/sdk` v1.25.1

## Suggested Features

### 1. Prompts (Ready-made scenarios)

Prompts provide pre-constructed conversation templates for common workflows.

#### `detect-objects`
Universal prompt for object detection (buildings, roads, forest, etc.) by location.

```typescript
server.registerPrompt(
  "detect-objects",
  {
    title: "Detect Objects",
    description: "Find objects (buildings, roads, etc.) in a specified area",
    argsSchema: {
      location: z.string().describe("Place name (e.g., 'Moscow, Russia')"),
      objectType: z.string().describe("Type of object: buildings, roads, forest, etc."),
    },
  },
  ({ location, objectType }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Find ${objectType} in "${location}".
Steps:
1. Use get-geoboundary for "${location}"
2. Use calculate-cost with appropriate model for ${objectType}
3. Show cost and area
4. If confirmed, start processing`,
      },
    }],
  })
);
```

#### `estimate-cost`
Help calculate processing cost for an area.

```typescript
server.registerPrompt(
  "estimate-cost",
  {
    title: "Estimate Processing Cost",
    description: "Calculate processing cost for an area",
    argsSchema: {
      location: z.string().describe("Place name"),
      modelName: z.string().optional().describe("Model name (optional)"),
    },
  },
  ({ location, modelName }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Estimate cost for "${location}"${modelName ? ` using ${modelName}` : ""}.
1. Get boundary via get-geoboundary
2. List models from mapflow://models
3. Calculate cost for ${modelName || "relevant models"}
4. Show summary with area (km2) and cost (credits)`,
      },
    }],
  })
);
```

---

### 2. Elicitation (User Confirmation)

Request user confirmation before starting a processing task to avoid accidental costs.

Modify `start-processing` tool to add cost confirmation:

```typescript
async ({ name, wdName, geometry, dataProvider, blocks, skipConfirmation }) => {
  // Calculate cost first
  const estimatedCost = await mapflowClient.calculateCost({
    wdName, geometry, dataProvider, blocks,
  });

  // Request confirmation unless skipped
  if (!skipConfirmation) {
    const result = await server.server.elicitInput({
      message: `Processing "${name}" costs ~${estimatedCost} credits. Proceed?`,
      requestedSchema: {
        type: "object",
        properties: {
          confirm: { type: "boolean", title: "Confirm" },
        },
        required: ["confirm"],
      },
    });

    if (result.action !== "accept" || !result.content?.confirm) {
      return {
        content: [{ type: "text", text: "Processing cancelled." }],
        structuredContent: { cancelled: true, estimatedCost },
      };
    }
  }

  // Proceed with processing...
}
```

---

### 3. Completion (Autocomplete)

Provide autocomplete suggestions for model names and imagery sources.

```typescript
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";

// Helpers
const getModelNames = async () => {
  const models = await mapflowClient.getModels();
  return models.map(m => m.name).filter((n): n is string => !!n);
};

const getImagerySourceNames = async () => {
  const sources = await mapflowClient.getImagerySources();
  return sources.map(s => s.name).filter((n): n is string => !!n);
};

// Usage in tool schema
wdName: completable(
  z.string().min(1).describe("Workflow display name"),
  async (value) => {
    const names = await getModelNames();
    return names.filter(n => n.toLowerCase().includes(value.toLowerCase()));
  }
)
```

---

### 4. Progress Notifications

Send progress updates during long-running processing tasks.

#### Add to `mapflow-client.ts`:

```typescript
export type MapflowClient = {
  // ... existing methods
  trackProcessingProgress: (
    processingId: string,
    onProgress: (status: string, percent: number) => void,
    intervalMs?: number
  ) => Promise<Processing>;
};

const trackProcessingProgress = async (
  processingId: string,
  onProgress: (status: string, percent: number) => void,
  intervalMs = 5000
) => {
  let lastPercent = -1;
  while (true) {
    const processing = await getProcessing(processingId);
    const percent = processing.percentCompleted ?? 0;
    const status = processing.status ?? "UNKNOWN";

    if (percent !== lastPercent) {
      onProgress(status, percent);
      lastPercent = percent;
    }

    if (["COMPLETED", "FAILED", "CANCELLED"].includes(status)) {
      return processing;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
};
```

#### Use in server:

```typescript
await server.server.sendLoggingMessage({
  level: "info",
  data: `Processing "${name}": ${status} - ${percent}% complete`,
});
```

---

## Implementation Order

1. **Completion** - Foundation, simplest to add
2. **Prompts** - Self-contained, provides workflow guidance
3. **Elicitation** - Cost confirmation (requires client support)
4. **Progress Notifications** - Requires mapflow-client changes

## Files to Modify

| File | Changes |
|------|---------|
| `src/server.ts` | Add prompts, elicitation, completion, notifications |
| `src/mapflow-client.ts` | Add `trackProcessingProgress` method |

## Notes

- All features available in SDK v1.25.1 - no new dependencies needed
- Elicitation requires client support (Claude Code, Cursor support it)
- Progress notifications use the logging channel
