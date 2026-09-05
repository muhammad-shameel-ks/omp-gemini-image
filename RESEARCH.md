# Oh My Pi (omp) Plugin System Research & Tool Authoring Guide

This document details the plugin architecture of [Oh My Pi](file:///home/shameel/.local/share/mise/installs/github-can1357-oh-my-pi/latest/omp) (`omp`), how to register custom LLM tools, how to render results and inline terminal images, and how to build and link the [`omp-gemini-image`](file:///home/shameel/workspace/omp-gemini-image) plugin.

All findings are derived directly from the primary sources in [`@oh-my-pi/pi-coding-agent`](file:///home/shameel/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/), [`@oh-my-pi/omptype`](file:///home/shameel/.omp/plugins/node_modules/@oh-my-pi/omptype/), [`@oh-my-pi/pi-tui`](file:///home/shameel/.omp/plugins/node_modules/@oh-my-pi/pi-tui/), and [`~/.omp/plugins`](file:///home/shameel/.omp/plugins/).

---

## 1. Plugin Architecture Overview

`omp` uses a unified extensibility architecture executed directly on top of the Bun runtime.
TypeScript files (`.ts`) are dynamically imported and executed natively without requiring a build step.

### Directory Structure & Config Files

Plugins installed for the user live in [`~/.omp/plugins`](file:///home/shameel/.omp/plugins/):

- [`~/.omp/plugins/package.json`](file:///home/shameel/.omp/plugins/package.json):
  Tracks top-level package dependencies installed via npm/git.
- [`~/.omp/plugins/omp-plugins.lock.json`](file:///home/shameel/.omp/plugins/omp-plugins.lock.json):
  The authoritative runtime configuration tracking installed and linked plugins, whether they are enabled, and their enabled feature sets.
- [`~/.omp/plugins/node_modules/`](file:///home/shameel/.omp/plugins/node_modules/):
  Houses installed dependencies and symlinks created by `omp plugin link`.

### Installed Plugin Analysis

1. [`omp-model-profile`](file:///home/shameel/.omp/plugins/node_modules/omp-model-profile/package.json):
   - In its `package.json`, it defines `"omp": { "extensions": ["./src/index.ts"] }`.
   - Its entry point [`index.ts`](file:///home/shameel/.omp/plugins/node_modules/omp-model-profile/src/index.ts) exports a default function:
     ```typescript
     export default function modelProfilesExtension(pi: ExtensionAPI): void
     ```
   - It utilizes `pi.on("session_start", ...)` and `pi.registerCommand("model-profile", ...)`.

2. [`pi-commandcode-provider`](file:///home/shameel/.omp/plugins/node_modules/pi-commandcode-provider/package.json):
   - Originates from the upstream Pi ecosystem and declares `"pi": { "extensions": ["./index.ts"] }`.
   - Demonstrates that `omp` includes a transparent compatibility layer via [`loadLegacyPiModule`](file:///home/shameel/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/plugins/legacy-pi-compat.ts#L2795).
   - Any imports from `@earendil-works/pi-coding-agent` or `@earendil-works/pi-ai` are automatically remapped to `@oh-my-pi/pi-coding-agent` and `@oh-my-pi/pi-ai` at runtime.

### The `omp plugin` CLI Commands

The CLI provides comprehensive plugin management via [`plugin-cli.ts`](file:///home/shameel/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/cli/plugin-cli.ts):

- `omp plugin list`: Displays all installed and linked plugins along with their status.
- `omp plugin link <path>`: Symlinks a local directory into [`~/.omp/plugins/node_modules/<name>`](file:///home/shameel/.omp/plugins/node_modules/) and updates [`omp-plugins.lock.json`](file:///home/shameel/.omp/plugins/omp-plugins.lock.json).
- `omp plugin install <name|path>`: Installs an npm package or links a local path (routing automatically to `link`).
- `omp plugin uninstall <name>`: Unlinks and removes a plugin.
- `omp plugin doctor`: Performs diagnostic checks on the plugin directory, lockfile, manifest, and symlinks.
- `omp plugin enable / disable <name>`: Toggles plugin active state.
- `omp plugin features <name>`: Manages optional feature sets declared in the plugin manifest.
- `omp plugin config <list|get|set|delete|validate>`: Manages plugin configuration keys.

### Conventional Sub-discovery Surfaces

In addition to manifest-declared entry points, [`omp-plugins.ts`](file:///home/shameel/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/discovery/omp-plugins.ts) automatically discovers sub-directories in any linked or installed plugin:

- `skills/`: Markdown skill definitions.
- `tools/`: Auto-discovered custom tool scripts (`tools/<name>.ts` or `tools/<name>/index.ts`).
- `hooks/`: Lifecycle hooks in `hooks/pre/` and `hooks/post/`.
- `commands/`: Markdown slash commands.
- `rules/`: System rules (`.md`, `.mdc`).
- `prompts/`: System/user prompt templates.
- `.mcp.json` / `mcp.json`: Embedded Model Context Protocol server declarations.

---

## 2. Tool Registration & Execution Contract

### Plugin Entry Points

An `omp` plugin registers tools primarily through the modern **Extension API**:

In `package.json`:
```json
"omp": {
  "extensions": [
    "./src/index.ts"
  ]
}
```

In `./src/index.ts`:
```typescript
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "Detailed description for the LLM",
    parameters: ...,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // ...
    }
  });
}
```

*(Note: Standalone custom tools can also be registered using `"omp": { "tools": "./src/tool.ts" }` with `export default function(pi: CustomToolAPI): CustomTool`, but `ExtensionAPI.registerTool` is preferred because it supports lifecycle events, slash commands, UI prompts, and full tool registration in a single module).*

### Supported Parameter Schemas

`omp` bundles [`@oh-my-pi/omptype`](file:///home/shameel/.omp/plugins/node_modules/@oh-my-pi/omptype/), an engine compatible with ArkType, Zod, and TypeBox.
The extension object injects these builders directly so plugins do not need to bundle their own schema dependencies:

1. **`pi.zod` (Zod Adapter - Recommended)**:
   ```typescript
   const z = pi.zod;
   parameters: z.object({
     prompt: z.string().describe("Description of the image to generate"),
     aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).default("1:1").describe("Aspect ratio"),
     samples: z.number().int().min(1).max(4).default(1).describe("Number of images"),
   })
   ```

2. **`pi.arktype` (ArkType / omptype Native)**:
   ```typescript
   const type = pi.arktype;
   parameters: type({
     prompt: "string",
     "aspectRatio?": "'1:1' | '16:9' | '9:16' | '4:3' | '3:4'",
     "samples?": "number.integer >= 1 & number.integer <= 4 = 1",
   })
   ```

3. **`pi.typebox` (TypeBox Adapter)**:
   ```typescript
   const { Type } = pi.typebox;
   parameters: Type.Object({
     prompt: Type.String({ description: "Image description" }),
   })
   ```

4. **Standard JSON Schema**:
   Standard JSON Schema objects (`{ type: "object", properties: { ... } }`) are automatically normalized to OpenAI/strict JSON Schema by `pi-ai`.

### The `execute` Function Signature

The execution callback on [`ToolDefinition`](file:///home/shameel/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts#L614) receives five arguments:

```typescript
async execute(
  toolCallId: string,
  params: Static<TParams>,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
  ctx: ExtensionContext,
): Promise<AgentToolResult<TDetails>>
```

- `toolCallId`: Unique ID assigned to this invocation by the LLM.
- `params`: Strictly validated parameters matching the defined schema.
- `signal`: Standard `AbortSignal` triggered if the user interrupts or cancels execution.
- `onUpdate`: Streaming progress callback `(partialResult) => void` for real-time UI status updates.
- `ctx`: [`ExtensionContext`](file:///home/shameel/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts#L455) providing:
  - `ctx.cwd`: Current project directory.
  - `ctx.ui`: UI dialogs, notifications (`notify`), and question selectors.
  - `ctx.modelRegistry`: Provider registry for looking up configured API keys.
  - `ctx.models`: Model query facade (`list()`, `current()`, `resolve()`).
  - `ctx.sessionManager`: Read-only access to session messages and branch trees.

### What the Tool Must Return

The tool must resolve to an [`AgentToolResult<TDetails>`](file:///home/shameel/.omp/plugins/node_modules/@oh-my-pi/pi-agent-core/src/types.ts#L680):

```typescript
export interface AgentToolResult<T = any> {
  content: (TextContent | ImageContent)[];
  details?: T;
  isError?: boolean;
}
```

- `content`: Array of content blocks sent to the model conversation history.
- `details`: Arbitrary JSON-serializable metadata saved into the session history.
- `isError`: Set to `true` to signal a soft error without throwing an unhandled rejection.

### Result Rendering & Inline Terminal Images

`omp`'s UI rendering is handled by [`ToolExecutionComponent`](file:///home/shameel/.omp/plugins/node_modules/@oh-my-pi/pi-coding-agent/src/modes/components/tool-execution.ts#L545).

#### How `omp` Renders Images

When rendering tool results in the TUI, `ToolExecutionComponent` extracts images from both `content` and `details.images`:

```typescript
#getAllImageBlocks(): ToolImageBlock[] {
  if (!this.#result) return [];
  const contentImages = this.#result.content.filter(block => block.type === "image");
  const details = this.#result.details;
  const detailImages = imageBlocksFromDetails(details);
  return [...contentImages, ...detailImages];
}
```

If the terminal supports image graphics (Kitty protocol, iTerm2, Sixel):
1. `omp` renders the image inline in the terminal using [`new Image(...)`](file:///home/shameel/.omp/plugins/node_modules/@oh-my-pi/pi-tui/src/components/image.ts).
2. For Kitty graphics terminals, non-PNG images (e.g. WebP, JPEG) are automatically converted to PNG asynchronously.

#### The Idiomatic Image Tool Pattern

> [!IMPORTANT]
> To avoid blowing up the LLM's context window with megabytes of base64 image data, do NOT place the base64 image in `content`.
> Instead, return a concise textual message in `content` and attach the image payload under `details.images`.

```typescript
return {
  content: [
    {
      type: "text",
      text: `Generated image saved to: ${savedFilePath}`,
    },
  ],
  details: {
    filePath: savedFilePath,
    images: [
      {
        data: base64ImageData,
        mimeType: "image/png",
      },
    ],
  },
};
```

This ensures:
1. The LLM only receives the concise text summary and file path.
2. The user sees the actual rendered image inline in their terminal.

---

## 3. Setting Up `/home/shameel/workspace/omp-gemini-image`

### `package.json` Specification

```json
{
  "name": "omp-gemini-image",
  "version": "0.1.0",
  "description": "Google Gemini Imagen image generation tool for Oh My Pi",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "keywords": [
    "omp",
    "oh-my-pi",
    "extension",
    "plugin",
    "tool",
    "image",
    "gemini",
    "imagen"
  ],
  "engines": {
    "bun": ">=1.3.14"
  },
  "omp": {
    "extensions": [
      "./src/index.ts"
    ]
  },
  "peerDependencies": {
    "@oh-my-pi/pi-ai": ">=15.10.11",
    "@oh-my-pi/pi-coding-agent": ">=15.10.11"
  },
  "devDependencies": {
    "@oh-my-pi/pi-ai": ">=15.10.11",
    "@oh-my-pi/pi-coding-agent": ">=15.10.11",
    "@types/bun": "^1.3.14",
    "typescript": "^5.8.2"
  }
}
```

### Local Linking & Development Workflow

To link the plugin directly into `omp`:

```bash
omp plugin link /home/shameel/workspace/omp-gemini-image
```

What this command executes under the hood:
1. Reads [`/home/shameel/workspace/omp-gemini-image/package.json`](file:///home/shameel/workspace/omp-gemini-image/package.json).
2. Verifies the `omp.extensions` or `omp.tools` manifest entries.
3. Creates a symlink at [`~/.omp/plugins/node_modules/omp-gemini-image`](file:///home/shameel/.omp/plugins/node_modules/omp-gemini-image) pointing to your workspace directory.
4. Registers `omp-gemini-image` in [`~/.omp/plugins/omp-plugins.lock.json`](file:///home/shameel/.omp/plugins/omp-plugins.lock.json) with `enabled: true`.

You can verify the link at any time with:

```bash
omp plugin list
omp plugin doctor
```

Because `omp` executes TypeScript directly via Bun, changes to files inside `/home/shameel/workspace/omp-gemini-image/src/` take effect immediately on your next session without any rebuild step.

---

## 4. Complete Code Example

Below is a production-ready, minimal working plugin implementing the `generate_gemini_image` tool.

### `src/index.ts`

```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

interface GeminiImagePart {
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiImagePart[];
  };
}

interface GeminiGenerateResponse {
  candidates?: GeminiCandidate[];
  error?: {
    code: number;
    message: string;
  };
}

export default function geminiImageExtension(pi: ExtensionAPI): void {
  const z = pi.zod;

  pi.registerTool({
    name: "generate_gemini_image",
    label: "Gemini Image Generator",
    description:
      "Generate an image using Google Gemini Imagen model. Returns the image and saves it to the workspace.",
    loadMode: "essential", // Keeps tool top-level and directly visible to LLM
    approval: "write", // Prompts approval when write-tier gating is enabled
    parameters: z.object({
      prompt: z.string().describe("The detailed text prompt describing the image to generate"),
      aspectRatio: z
        .enum(["1:1", "16:9", "9:16", "4:3", "3:4"])
        .default("1:1")
        .describe("Aspect ratio for the generated image"),
      outputFileName: z
        .string()
        .optional()
        .describe("Optional filename to save the image as in the workspace (default: generated timestamped name)"),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      const { prompt, aspectRatio, outputFileName } = params;

      // 1. Resolve Gemini API Key (checking omp model registry first, then environment)
      let apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey && ctx.modelRegistry) {
        try {
          const resolved = await ctx.modelRegistry.getApiKeyForProvider("google", ctx.sessionManager?.getSessionId());
          if (typeof resolved === "string" && resolved.length > 0) {
            apiKey = resolved;
          }
        } catch {
          // Fall back to environment variable check
        }
      }

      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: "Error: No Gemini API key found. Set GEMINI_API_KEY in your environment or configure google in omp.",
            },
          ],
          isError: true,
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: `Generating image for prompt: "${prompt}"...` }],
      });

      // 2. Call Google Gemini Imagen endpoint
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: {
              sampleCount: 1,
              aspectRatio: aspectRatio ?? "1:1",
              outputMimeType: "image/png",
            },
          }),
          signal,
        });

        if (!response.ok) {
          const errorBody = await response.text();
          return {
            content: [{ type: "text", text: `Gemini API error (${response.status}): ${errorBody}` }],
            isError: true,
          };
        }

        const data = (await response.json()) as {
          predictions?: Array<{ bytesBase64Encoded: string; mimeType: string }>;
        };

        const imagePrediction = data.predictions?.[0];
        if (!imagePrediction?.bytesBase64Encoded) {
          return {
            content: [{ type: "text", text: "Gemini API did not return any image data." }],
            isError: true,
          };
        }

        // 3. Save the image to the workspace
        const imagesDir = path.join(ctx.cwd, "generated-images");
        await fs.mkdir(imagesDir, { recursive: true });

        const fileName = outputFileName || `gemini_${Date.now()}.png`;
        const filePath = path.join(imagesDir, fileName.endsWith(".png") ? fileName : `${fileName}.png`);
        const buffer = Buffer.from(imagePrediction.bytesBase64Encoded, "base64");
        await fs.writeFile(filePath, buffer);

        // 4. Return summary for LLM + base64 image in details for omp inline TUI rendering
        return {
          content: [
            {
              type: "text",
              text: `Image successfully generated and saved to: ${filePath}\nAspect Ratio: ${aspectRatio}\nPrompt: "${prompt}"`,
            },
          ],
          details: {
            filePath,
            aspectRatio,
            images: [
              {
                data: imagePrediction.bytesBase64Encoded,
                mimeType: imagePrediction.mimeType || "image/png",
              },
            ],
          },
        };
      } catch (err) {
        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Image generation was cancelled." }],
            isError: true,
          };
        }
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Failed to generate image: ${errorMsg}` }],
          isError: true,
        };
      }
    },
  });
}
```

---

## 5. Summary of Key Guidelines

- **Manifest format**: Use the `"omp"` field in `package.json` with `"extensions": ["./src/index.ts"]`.
- **Schema authoring**: Use `pi.zod` for argument schemas to avoid unnecessary dependencies.
- **Image display**: Put the base64 image data inside `details.images: [{ data, mimeType }]` to enable inline terminal rendering without polluting model context.
- **Linking**: Use `omp plugin link <absolute-path>` to register your local package for development.
