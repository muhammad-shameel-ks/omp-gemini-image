# omp-gemini-image

Google Gemini and Imagen image generation plugin for [Oh My Pi](https://github.com/can1357/oh-my-pi) (`omp`).
Uses your pre-existing Google Antigravity OAuth credentials to generate and edit images directly inside your Oh My Pi agent sessions.

## Features

- **Built-in Antigravity Auth**: Automatically leverages your existing Google Antigravity OAuth credentials stored in `omp`.
- **Zero Configuration**: No external API keys or Google Cloud configurations required if you are already logged into Antigravity via `omp`.
- **Automatic Token Refresh**: Transparently queries `omp token google-antigravity` and handles OAuth token expiration and refreshing.
- **Inline Terminal Display**: Returned images are structured for Oh My Pi's TUI renderer, displaying graphics inline in Kitty, iTerm2, and Sixel-supported terminals.
- **Saved to Workspace**: All generated images are persisted directly to `<workspace>/generated-images/`.
- **Multi-aspect Ratio**: Supports `1:1`, `16:9`, `9:16`, `4:3`, and `3:4` aspect ratios.
- **Reference Image Conditioning**: Accepts optional input image paths for image-to-image editing or conditioning.

## Installation

Link the plugin directly into your local Oh My Pi installation:

```bash
omp plugin link /home/shameel/workspace/omp-gemini-image
```

Verify that Oh My Pi has registered the plugin:

```bash
omp plugin list
omp plugin doctor
```

## How It Works

1. **Credential Resolution**: When `generate_image` is invoked, the plugin requests credentials from Oh My Pi using `omp token google-antigravity --raw`.
2. **Endpoint Dispatch**: It constructs a multimodal generation payload and sends an SSE stream request to Google's Cloud Code Assistant service (`daily-cloudcode-pa.googleapis.com`).
3. **Stream Parsing & Persistence**: The plugin streams the response, decodes the resulting base64 image data, and writes the image file to `<workspace>/generated-images/`.
4. **Context & UI Delivery**: A concise markdown summary is returned to the agent context while the full graphic is passed to `details.images` for high-resolution terminal rendering.

## Tool Definition

The plugin registers the `generate_image` tool:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `prompt` | `string` | *(required)* | Detailed text description of the image to generate. |
| `aspectRatio` | `string` | `"1:1"` | Aspect ratio (`1:1`, `16:9`, `9:16`, `4:3`, `3:4`). |
| `outputFileName`| `string` | `undefined` | Optional filename without extension to save as. |
| `imagePaths` | `string[]` | `undefined` | Optional paths to local images to condition or edit upon. |
| `model` | `string` | `"gemini-3.1-flash-image"` | Optional Google image model override. |

## License

MIT
