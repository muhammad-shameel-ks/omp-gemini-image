export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

export interface AntigravityCredentials {
  token: string;
  projectId: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
}

export interface GenerateImageOptions {
  prompt: string;
  aspectRatio?: AspectRatio;
  outputFileName?: string;
  imagePaths?: string[];
  model?: string;
}

export interface GeneratedImageResult {
  filePath: string;
  mimeType: string;
  base64Data: string;
  aspectRatio: string;
  prompt: string;
  thoughtText?: string;
}
