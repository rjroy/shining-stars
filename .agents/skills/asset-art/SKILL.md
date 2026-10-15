---
name: asset-art
description: Produce authorized 2D game artwork for Shining Stars, such as illustrated collection emblems, sprites, textures, and backgrounds, using the approved Codex image route. Use for production artwork, not exploratory concept images or Blender derivatives.
---

# 2D asset art

Follow the separate 2D branch in [asset-workflow](../asset-workflow/SKILL.md). This skill covers production artwork, not exploratory concept images ([concept-art](../concept-art/SKILL.md)), Blender modeling/derivatives, or runtime implementation. Skill authoring and an approved brief do not authorize image generation: require both an explicitly approved production brief and task-specific authorization for the image-generation work.

## Before generation

- The designer owns visual direction. Confirm the approved brief, authorized mockup/reference paths, intended game role, and any exclusions; ask the designer/user to resolve visual decisions rather than inventing a direction.
- Agree on the expected consumer, framing, silhouette, safe padding, and consistent scale across the set. State whether real transparency is required or a background is intended. Agree on projected display sizes, output dimensions/ratio, and file-size budget with the task owner; unknown budgets remain unknown, never guessed.
- Keep lettering out of reusable art unless expressly approved. Put accessible labels and hit controls in DOM/UI, not baked into images. Three.js glow, overlays, and animation belong to runtime implementation and remain separate from reusable source art.
- Use the current mockups and approved project direction cited by the brief; draft lore is context, not approval. Flag conflicts rather than choosing silently.

## Authorized generation and staging

Use only the user's authorized Codex image-generation route. Pass the approved prompt through stdin and let the generator write its actual image to its normal native staging location; then copy the verified image to an authorized review-candidate path. For example:

```bash
codex exec --skip-git-repo-check - <<'PROMPT'
[Approved production brief and task-specific authorization.] Generate the actual 2D production artwork using the normal image-output mechanism. Report the absolute native output path(s). Do not modify unrelated project files.
PROMPT
```

`--skip-git-repo-check` is the authorized route flag, not a permission or sandbox bypass. Do not add bypass flags, weaken controls, install tools, change global configuration, or use permission workarounds. `-o/--output-last-message` writes text, not an image. Allow normal native staging; copy only the actual generated image, never a placeholder presented as generator output. No nested git/Beads commands or unrelated writes. If staging or destination access fails, report the exact path and blocker; do not improvise a workaround.

## Verify, preserve, and approve

1. Check that the native output exists, is nonempty, decodes, and can be visually inspected. Compare the actual image with the approved brief and authorized references; command success alone is not evidence of a usable asset.
2. If alpha is required, inspect the decoded alpha channel and verify transparent and opaque pixels. A checkerboard painted into RGB is not transparency. Composite the image over both dark and light runtime backgrounds and inspect edges for halos, matte color, and premultiplication artifacts. Never promise that the generator produced real alpha. If it did not, report the blocker and request either an approved alternative or an approved background-removal route; do not silently key or destructively remove a background.
3. Inspect at projected display size and in relevant cropped/selected states. For a collection, compare variants together for framing, silhouette, scale, and style consistency. Review reusable art without runtime glow/animation masking defects.
4. Copy the verified original into a stable candidate package compatible with the existing `assets/authoring/` and `assets/production/` conventions. Keep approved source/master art distinct from production derivatives; do not overwrite approved files with candidates. Preserve a high-quality native/master source. Choose reproducible PNG or WebP (WebP only when required alpha is verified); do not apply blanket lossy conversion. Record source and copy hashes, provenance/native and durable paths, tool/version, date, approval status, decoded dimensions/format, color space (including runtime sRGB handling where applicable), and derivative dimensions/ratio/size. Include only minimal reproduction/conversion commands and relevant version details, no historic scratch cruft.
5. Present the actual inspected candidate and obtain explicit approval of that exact artwork version before promoting it as approved. Artwork approval is not production-derivative approval or runtime acceptance. Derivatives need their own authorized scope and review; runtime integration and acceptance are separate and require actual-game verification. A screenshot, successful command, or derivative check never implies approval of a later gate.

If image decoding, alpha verification, provenance, copy, visual inspection, or approval is incomplete, label the candidate and report what remains. Do not claim a production handoff without the real inspected artwork and its recorded provenance.

## Brief prompt template

```text
Asset and role: [what this art represents and where it appears]
Approved visual direction: [approved description; cite exact mockup/reference paths]
Framing and set consistency: [view/crop, silhouette, safe padding, scale relative to set]
Display and delivery: [agreed projected sizes, ratio/dimensions, file-size budget; mark unknowns]
Background/alpha: [real transparent pixels required, or intended background]
Constraints: [palette/material cues, exclusions; no baked text, labels, controls, glow, or animation unless specifically approved]
Output: generate actual artwork with the authorized route; report native absolute path. Do not modify unrelated files.
```

## Handoff checklist

- [ ] Approved brief and task-specific generation authorization recorded.
- [ ] Actual native image decodes and was visually inspected against the brief.
- [ ] Required alpha was verified at pixel level and on dark/light composites, or blocker/approved alternative recorded.
- [ ] Projected-size/crop review and collection consistency check completed.
- [ ] Candidate path, source/copy hashes, provenance, versions/date, dimensions/format, color space, and status recorded.
- [ ] Exact artwork approval, derivative approval, and runtime acceptance remain distinct; request each later approval separately.
