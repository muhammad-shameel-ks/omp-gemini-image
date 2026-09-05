import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAntigravityCredentials } from "./auth.js";
import type { GenerateImageOptions, GeneratedImageResult } from "./types.js";

const DEFAULT_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
const FALLBACK_ENDPOINT = "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
const DEFAULT_MODEL = "gemini-3.1-flash-image";

interface ParsedCandidatePart {
  inlineData?: {
    mimeType: string;
    data: string;
  };
  text?: string;
  thoughtSignature?: string;
}

interface ParsedStreamChunk {
  response?: {
    candidates?: Array<{
      content?: {
        role?: string;
        parts?: ParsedCandidatePart[];
      };
    }>;
  };
  error?: {
    code: number;
    message: string;
    status: string;
    details?: Array<{
      metadata?: Record<string, string>;
    }>;
  };
}

/**
 * Reads a local file and encodes it as base64 inline data for multimodal requests.
 */
async function fileToInlineData(filePath: string): Promise<{ mimeType: string; data: string }> {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  const mimeType = mimeMap[ext] || "image/png";
  const fileBuffer = await fs.readFile(filePath);
  return {
    mimeType,
    data: fileBuffer.toString("base64"),
  };
}

/**
 * Executes an image generation call via Google Antigravity Cloud Code endpoint.
 */
export async function generateImage(
  options: GenerateImageOptions,
  workspaceDir: string,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void
): Promise<GeneratedImageResult> {
  const { prompt, aspectRatio = "1:1", outputFileName, imagePaths, model = DEFAULT_MODEL } = options;

  let creds = await getAntigravityCredentials(false);

  // Prepare input contents (prompt + optional reference images)
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: prompt },
  ];

  if (imagePaths && imagePaths.length > 0) {
    onProgress?.(`Reading ${imagePaths.length} reference image(s)...`);
    for (const imgPath of imagePaths) {
      try {
        const fullPath = path.isAbsolute(imgPath) ? imgPath : path.join(workspaceDir, imgPath);
        const inlineImg = await fileToInlineData(fullPath);
        parts.push({ inlineData: inlineImg });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read input reference image '${imgPath}': ${errMsg}`);
      }
    }
  }

  const payload = {
    project: creds.projectId,
    model: model,
    request: {
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      systemInstruction: {
        parts: [
          {
            text: "You are an AI image generator. Generate images based on user descriptions. Focus on creating high-quality, visually appealing images that match the user's request.",
          },
        ],
      },
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          aspectRatio,
        },
        candidateCount: 1,
      },
    },
    requestType: "agent",
    requestId: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userAgent: "antigravity",
  };

  const endpointsToTry = [DEFAULT_ENDPOINT, FALLBACK_ENDPOINT];
  let lastError: Error | null = null;

  for (const endpoint of endpointsToTry) {
    try {
      onProgress?.(`Contacting Google image model (${model})...`);

      let resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "User-Agent": "antigravity",
        },
        body: JSON.stringify(payload),
        signal,
      });

      // Handle 401 Unauthorized by refreshing token once
      if (resp.status === 401) {
        onProgress?.("Refreshing expired Antigravity token...");
        creds = await getAntigravityCredentials(true);
        resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${creds.token}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "User-Agent": "antigravity",
          },
          body: JSON.stringify(payload),
          signal,
        });
      }

      if (!resp.ok) {
        const errText = await resp.text();
        let parsedErrorMsg = errText;
        try {
          const errObj = JSON.parse(errText) as ParsedStreamChunk;
          if (errObj.error) {
            const code = errObj.error.code;
            const message = errObj.error.message;
            const resetDelay = errObj.error.details?.[0]?.metadata?.quotaResetDelay;

            if (code === 429) {
              parsedErrorMsg = `Google Antigravity image generation quota exceeded. ${message}${
                resetDelay ? ` (Resets in: ${resetDelay})` : ""
              }`;
            } else {
              parsedErrorMsg = `Google API Error (${code}): ${message}`;
            }
          }
        } catch {
          // Keep raw errText
        }

        // If it's a 429 quota error, no need to retry other endpoints
        if (resp.status === 429) {
          throw new Error(parsedErrorMsg);
        }

        lastError = new Error(`Request failed (${resp.status}): ${parsedErrorMsg}`);
        continue;
      }

      // Read SSE stream
      const reader = resp.body?.getReader();
      if (!reader) {
        throw new Error("No response stream body returned from Google image endpoint.");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let foundImage: { mimeType: string; data: string } | null = null;
      let thoughtText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const chunk = JSON.parse(jsonStr) as ParsedStreamChunk;
            if (chunk.error) {
              throw new Error(chunk.error.message);
            }

            const candidates = chunk.response?.candidates || [];
            for (const cand of candidates) {
              for (const part of cand.content?.parts || []) {
                if (part.inlineData && part.inlineData.data) {
                  foundImage = {
                    mimeType: part.inlineData.mimeType || "image/png",
                    data: part.inlineData.data,
                  };
                }
                if (part.text) {
                  thoughtText += part.text;
                }
              }
            }
          } catch (e) {
            // Ignore partial SSE parsing issues unless it's a thrown error
            if (e instanceof Error && e.message.includes("quota")) {
              throw e;
            }
          }
        }
      }

      if (!foundImage) {
        throw new Error("Google image model completed response but did not return any image data.");
      }

      // Save image to output directory
      const outputDir = path.join(workspaceDir, "generated-images");
      await fs.mkdir(outputDir, { recursive: true });

      const extension = foundImage.mimeType.includes("jpeg") || foundImage.mimeType.includes("jpg") ? "jpg" : "png";
      const sanitizedName = outputFileName
        ? outputFileName.replace(/[^a-zA-Z0-9_\-\.]/g, "_")
        : `image_${Date.now()}`;
      const finalFileName = sanitizedName.endsWith(`.${extension}`) ? sanitizedName : `${sanitizedName}.${extension}`;
      const finalFilePath = path.join(outputDir, finalFileName);

      const imageBuffer = Buffer.from(foundImage.data, "base64");
      await fs.writeFile(finalFilePath, imageBuffer);

      return {
        filePath: finalFilePath,
        mimeType: foundImage.mimeType,
        base64Data: foundImage.data,
        aspectRatio,
        prompt,
        thoughtText: thoughtText || undefined,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // If error was quota or user cancel, fail immediately without hitting next endpoint
      if (signal?.aborted || lastError.message.includes("quota")) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error("Failed to generate image on all available Google endpoints.");
}
