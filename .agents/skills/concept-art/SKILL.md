---
name: concept-art
description: Generate and verify concept images for an explicitly approved Shining Stars asset brief using the user's authorized Codex image-generation route. Use when asset-workflow reaches its concept-art stage.
---

# Concept art

Follow the approval gates and handoff rules in [asset-workflow](../asset-workflow/SKILL.md). This skill is for concept images only, not modeling, asset production, or runtime integration. A request to author skills is not authorization to generate an image; require an approved brief and task-specific authorization first.

## Route and verification

Use the **user-reported** `codex exec '<prompt>'` route for image generation. Local `codex exec --help` confirms the invocation shape (`codex exec [OPTIONS] [PROMPT]`), but **image-generation capability has not been smoke-tested**. Do not claim it works until an actual image has been produced and verified. Do not use permission-bypass flags or evade authentication, sandbox, or approval controls.

1. Use the approved brief as the prompt; include the asset's intended game view, silhouette/material cues, project constraints, and a request for one clear concept image. Specify an **absolute output path** in a task-authorized output location, and instruct the tool to save an image there. Do not overwrite an existing approved image; use a new versioned filename.
2. For example, after substituting the authorized absolute output path and approved brief details, pass the prompt through stdin:

   ```bash
   codex exec - <<'PROMPT'
   Generate one actual concept-art image for this approved asset brief: [approved brief and intended framing]. Save the generated image at exactly /absolute/authorized/path/asset-concept-v1.png. Write no other files and do not modify project files. If image generation or saving at that exact path is unavailable, do not create a substitute; report the failure and stop.
   PROMPT
   ```

   Local help documents `-` as reading the prompt from stdin and says piped stdin is appended when a prompt is also supplied. It documents `-o, --output-last-message <FILE>` as writing the final text response, **not** an image; do not use it as the image-output mechanism. Do not substitute text returned by the model for an image file.
3. Verify the exact output path exists, has plausible nonzero image data, and can actually be decoded and viewed with an available local image viewer/decoder. Inspect the image yourself against the approved brief, project reference, and intended framing; identify mismatches or content that violates constraints before presenting it. A successful command or textual response alone is not evidence of an image. Record the verified path and show the actual image to the user.
4. Obtain explicit approval of that image before handing it to modeling. Record the approval and exact image version in the asset handoff. Requested revisions produce a new version and require review; never silently replace an approved concept.

Image-generation capability has not yet been smoke-tested, so verify it in an authorized task before relying on this route. If authentication/permission is denied, the command fails, output is missing, or image decoding/viewing fails, stop and report the specific failure and path. Ask the user for a supported route or corrected access. Do not retry by bypassing controls, claim success, generate a programmatic placeholder, or offer a placeholder as if it were generated concept art. No verified image means no concept-art handoff and no modeling progression.
