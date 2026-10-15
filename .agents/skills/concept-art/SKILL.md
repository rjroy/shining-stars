---
name: concept-art
description: Generate and verify exploratory concept images for an explicitly approved Shining Stars asset brief using the user's authorized Codex image-generation route. Use for concept exploration, not final 2D production artwork; use asset-art for production 2D artwork.
---

# Concept art

Follow the approval gates and handoff rules in [asset-workflow](../asset-workflow/SKILL.md). This skill is for exploratory concept images only, not production artwork, modeling, asset derivatives, or runtime integration. Use [asset-art](../asset-art/SKILL.md) for actual 2D game artwork. A request to author skills is not authorization to generate an image; require an approved brief and task-specific authorization first.

## Route and verification

Use the authorized `codex exec` route for image generation. A successful, verified generation was observed on **2026-10-10** with Codex **0.162.1** using `codex exec --skip-git-repo-check`; this is evidence that the route can work, not a guarantee that another environment or invocation will work. `--skip-git-repo-check` skips the repository check only; it is not a permission, authentication, or sandbox bypass. Do not use other bypass flags or weaken authentication, sandbox, or approval controls.

1. Confirm an approved brief and task-specific authorization before generating. Use the brief and authorized references to prompt for the intended game view, silhouette/material cues, constraints, and a clear concept image. Keep one stable asset directory; preserve candidates during active review, but record version identifiers in the README/approval history rather than creating permanent numbered directories for every attempt.
2. The image generator may write its actual image to its normal native staging location before the parent agent copies it to an authorized review-candidate path. It cannot be relied on to obey an exact-destination-only or no-other-files instruction. Normal image-tool staging artifacts are allowed; unrelated project writes are not. Prefer the native image output followed by an explicitly authorized copy. Do not ask the image tool to write the concept into a guessed temp path. If direct output is specifically required, first ensure the launcher context can traverse/read its reference inputs and write the authorized destination. The launcher may run under a different user/context than the invoking shell; do not assume the current account's temp directory is accessible. If access is missing, stop and report the exact path/access failure for the user to resolve. Never use blanket `chmod`, `sudo`, permission workarounds, or installations.
3. Pass the prompt via stdin, including the approved route flag, and ask the tool to generate the actual image using its normal image-output mechanism and report the absolute native output path(s):

   ```bash
   codex exec --skip-git-repo-check - <<'PROMPT'
   Generate one actual concept-art image for this approved asset brief: [approved brief, intended framing, and authorized references]. Use the normal image-generation output mechanism. Report the absolute path of the generated image. Do not modify unrelated project files.
   PROMPT
   ```

   `-o, --output-last-message <FILE>` writes the final text response, **not** an image. Never use it as an image-output mechanism or treat returned text as an image.
4. Verify the reported original path exists, has nonzero image data, and can be decoded and opened for visual inspection. Compare it with the approved brief, references, framing, and exclusions; record mismatches rather than inferring quality from command success. Copy the actual image (not a placeholder) to an authorized review-candidate path in the stable asset directory; do not overwrite an approved image before its replacement is approved. Verify the copy decodes, inspect it, and compare source/copy checksums. Record native and durable paths, dimensions/format, checksum, tool/version, date, and approval status in the README/approval history. Keep the native original until the durable copy and provenance are verified; it need not remain indefinitely afterward.
5. Report failures at the stage they occurred: launcher/DNS/filesystem/access failure, image-generation route failure, missing or unusable native output, copy failure, or decode/view failure. Preserve useful diagnostics and exact paths. Do not retry by bypassing controls, use a programmatic placeholder, or claim success without inspecting the image. Ask for a supported route or access correction when blocked.
6. Show the actual verified image and obtain explicit approval of that exact version before modeling. Record approval separately from brief approval, then promote the approved candidate to the stable approved-concept path; retain prior approved evidence in the authorized archive/history. Concept approval does not approve the model, export, runtime integration, or runtime acceptance. Respect a user's decision to keep an existing model or defer further refinement; do not infer any later approval from that decision.

No verified image means no concept-art handoff and no progression through the concept-approval gate.
