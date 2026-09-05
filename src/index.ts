import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { generateImage } from "./client.js";
import type { AspectRatio } from "./types.js";

/**
 * Oh My Pi Extension: omp-gemini-image
 * Adds image generation capabilities using Google Antigravity credentials.
 */
export default function (pi: ExtensionAPI): void {
  const z = pi.zod;

  // Define parameter schema using Oh My Pi's built-in zod builder
  const imageParams = z.object({
    prompt: z
      .string()
      .describe("The detailed text prompt describing the image to generate"),
    aspectRatio: z
      .enum(["1:1", "16:9", "9:16", "4:3", "3:4"])
      .default("1:1")
      .describe("Aspect ratio for the generated image (default: '1:1')"),
    outputFileName: z
      .string()
      .optional()
      .describe("Optional name for the saved image file without extension"),
    imagePaths: z
      .array(z.string())
      .optional()
      .describe("Optional local image paths to use as reference or context for generation"),
    model: z
      .string()
      .optional()
      .describe("Optional model override (default: 'gemini-3.1-flash-image')"),
  });

  pi.registerTool({
    name: "generate_image",
    label: "Generate Image",
    description:
      "Generate an image based on a text prompt or reference images using Google Gemini Imagen models with your Google Antigravity credentials. Saves the resulting image to the workspace and displays it inline.",
    parameters: imageParams,
    loadMode: "essential",
    approval: "write",

    async execute(toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      const workspaceDir = ctx.cwd || process.cwd();

      onUpdate?.({
        content: [
          {
            type: "text",
            text: `Initializing Google Antigravity image generation for: "${params.prompt}"...`,
          },
        ],
      });

      try {
        const result = await generateImage(
          {
            prompt: params.prompt,
            aspectRatio: params.aspectRatio as AspectRatio,
            outputFileName: params.outputFileName,
            imagePaths: params.imagePaths,
            model: params.model,
          },
          workspaceDir,
          signal,
          (statusText) => {
            onUpdate?.({
              content: [
                {
                  type: "text",
                  text: statusText,
                },
              ],
            });
          }
        );

        let summary = `Image successfully generated and saved to: ${result.filePath}\nPrompt: "${result.prompt}"\nAspect Ratio: ${result.aspectRatio}`;
        if (result.thoughtText) {
          summary += `\nModel Notes: ${result.thoughtText.trim()}`;
        }

        return {
          content: [
            {
              type: "text",
              text: summary,
            },
          ],
          details: {
            filePath: result.filePath,
            aspectRatio: result.aspectRatio,
            images: [
              {
                data: result.base64Data,
                mimeType: result.mimeType,
              },
            ],
          },
        };
      } catch (err) {
        if (signal?.aborted) {
          return {
            content: [
              {
                type: "text",
                text: "Image generation was cancelled.",
              },
            ],
            isError: true,
          };
        }

        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Failed to generate image: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
