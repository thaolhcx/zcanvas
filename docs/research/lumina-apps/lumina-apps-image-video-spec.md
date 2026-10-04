# BytePlus Lumina — standalone Image / Video generation and AI Apps

This is part 2 of the Lumina study. Part 1 covered the five canvas nodes: [../lumina/lumina-nodes-spec.md](../lumina/lumina-nodes-spec.md). This part covers the generators **outside the canvas**:
- the **Image** page
- the **Video** page, including Director mode
- the **AI Apps** library

These are the closest counterparts of the canvas Image/Video nodes. Use this note to plan zcanvas's generation UX and its template/app layer.

| | |
|---|---|
| Studied | 2026-10-02, `ai.byteplus.com/lumina/en/model/image`, `/model/video`, `/ai-app` (English UI) |
| Method | Used the UI by hand. Read form schemas, model catalogues and app graphs from the page's React state. Ran 2 real image generations. |
| Credits spent | 18: Seedream 5.0 Pro t2i with reference = 9, region edit = 9. Prompt optimisation used 0 credits (see §5.5). No video was generated here; video generation was already covered in part 1. |
| Evidence | 47 screenshots in [`img/`](img/). Raw notes, full schemas and app graphs are in [`_raw-notes.md`](_raw-notes.md). |
| Not tested | Local upload (OS picker), Explore community feed in depth, Audio page, Agent, Canvas Pro, running a paid video, running an app. |

---

## TL;DR — what matters for zcanvas

1. **One composer for all media.** The Image and Video pages are the same shell: a chat-like **feed** of past runs above a bottom **composer**. The first chip switches between AI Image, AI Video and Audio. Everything else (reference slot, model, function, size, advanced, price, Generate) follows the model's schema.
2. **The schema is split by the backend for you.** Video models ship `config_schemas` (inline chips), `advance_config_schemas` (Adv Params) and `mm` constraints for multimodal references (max count, formats, size, dimensions, aspect, duration per kind). This is cleaner than the canvas, where the client decides placement. **zcanvas should copy this split into its registry.**
3. **References are first-class tokens.** Uploaded or library images become `Image001…` chips you place in the prompt with `@`. Regions drawn in the **Artboard** become `Region01` chips (rectangle, dot or brush annotations). We ran "@Region01 add a tiny red beret": only that area changed.
4. **Director mode is a structured prompt builder with a UI on top.** It's a two-track timeline (camera shots + voice segments) with per-shot type, text, duration handles, global style and a negative prompt. **"Transcribe to creative mode"** compiles it into plain text: `Duration / Visual Development: 0 s~1 s: … / Music Development / Prohibited content`. The model still receives one prompt.
5. **The feed is the version history.** Every run is a card with prompt, chips, params and result, plus Re-edit, Regenerate and a ⋯ menu (Video Editing, Draw, Collect, Download, Share link, Delete). A detail modal shows the full params (including the real seed) and **Clone & try**. The canvas has nothing equivalent per node.
6. **An AI App is a published canvas workflow.** It's the same `comfyui-ecology` record with `publish_as_app: true`, a node graph, and `ba_extra.slot_info` listing which node inputs are exposed as form fields (`node_id`, `input_key`, `format`, `ui_order`) and which node is the output. That is the same idea as zcanvas's `meta.template.inputs`. Fixed cost per run, revisions, p75 duration and success rate are stored on the app.
7. **Credits are charged at submit** (the balance drops immediately), and price is shown everywhere: on the Generate button, in a Cost Details hover, in app "✦ 450/time" buttons, and as promo badges in the model list ("Up to 86% off").

---

## 1. Information architecture

| Area | Path | What it is |
|---|---|---|
| Home | `/lumina/en` | Hero carousel, model cards, canvas templates, quick composer; "What's new" modal on entry ([00](img/00-home-whats-new-modal.jpg)) |
| **Image** | `/model/image?mode=image` | Feed + composer for images ([10](img/10-image-page-feed-and-composer.jpg)) |
| **Video** | `/model/video?mode=video` | Feed + composer for video, with Creation/Director modes ([30](img/30-video-page-feed-composer.jpg)) |
| Audio | `/model/audio` | Same shell (not studied) |
| **AI Apps** | `/ai-app`, `/ai-app/<id>` | App Library and app runner ([40](img/40-ai-apps-library.jpg)) |
| Canvas / Canvas Pro | — | Covered in part 1 |
| Assets | — | Material library (also opened from the composer) |

Hovering a sidebar item opens a **model flyout**, a deep link straight into a model or mode:
- **Image** ([01](img/01-sidebar-image-model-flyout.jpg)): Seedream 5.0 Pro › (Universal Reference, Layer separation), GPT Image 2 (Beta), Seedream 5.0 Lite, Nano Banana 2 (Beta), Nano Banana Pro (Beta), Seedream 4.5, Seedream 4.0, Seedream 3.0L (Art Edition), Seedream 3.0L ([02](img/02-sidebar-seedream5pro-submenu.jpg)).
- **Video** ([03](img/03-sidebar-video-model-flyout.jpg)): Seedance 2.5 ›, 2.0 Mini ›, 2.0 ›, 2.0 Fast ›, 1.5 Pro ›, 1.0 Pro, 1.0 Fast ›, 1.0 ›, DreamActor 2.0. Each submenu lists modes such as Freestyle Creation, Multi-frame Editing, Video Editing, Extend Video, Image To Video and Text To Video.

The top bar has Help, language, gifts, the credit balance and **Upgrade**. A promo banner reads "MEMBER EXCLUSIVE — up to 86% off Seedance 2.0 Mini & Fast".

---

## 2. Shared shell: feed + composer

```
┌────────────────────────────── feed (scrolls, newest at bottom) ───────────────────────────┐
│ 2026-10-02 10:46:24                                                                         │
│ [Image001] as a cute 3D clay figurine sitting on a coffee cup, studio lighting              │
│ (model) Seedream 5.0 Pro | (thumb) Reference images | Proportion 1:1 | Adv Params ⓘ         │
│ ┌──────────┐ ⋯                                                                              │
│ │  result  │                                                                                │
│ └──────────┘                                                                                │
│ [✎ Re-edit] [↻ Regenerate] [🗑]                       (while running: [⊘ Terminate generation]) │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
 [✦ Edit reference images directly with Artboard!  (Draw to edit)  ×]
┌──────────────────────────────────── composer ─────────────────────────────────────────────┐
│ ┌────┐  Describe the scene you want to generate, you can enter @ to reference an     [⤢]   │
│ │ref+│  image or annotation                                                                 │
│ └────┘                                                                                      │
│ [AI Image ▾] [model] [function ▾] [▢ 1:1] [⇄]                      Pricing ⓘ [Generate ✦9] │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                                        right dock: [Explore | History]
```

| Element | Behaviour |
|---|---|
| Media switch | `AI Image ▾` → AI Image / AI Video / Audio. It swaps the whole composer and the URL `mode` ([11](img/11-composer-media-type-switch.jpg)). |
| Reference slot | Hover → **local upload** or **material library** (video adds **Portrait Gallery** and **3D Director's Desk**). When filled it shows a thumbnail with a **+** badge to stack more ([18](img/18-image-ref-slot-upload-or-library.jpg)). |
| Material library | Full-screen sheet with tabs Image, Public/Private, a Filter (Type: All, Character, Props, Costume, Scene, Effects, Clear Filter), a "Selected: N" counter and OK ([19](img/19-material-library-picker.jpg), [1A](img/1A-material-library-filter-selected.jpg)). |
| Prompt editor | A Slate rich editor. `@` lists references (auto-named **Image001**, plus **Region01** for annotations) and **Color selection ›** ([1B](img/1B-image-at-mention-image001-color.jpg)). It inserts inline avatar chips ([1C](img/1C-image-prompt-with-inline-ref-chip.jpg)). ⤢ expands it. |
| Footer chips | Rendered from the model schema (see §3 and §5). Narrow widths **clip** chips: at 1071 px the 1:1 and ⇄ chips are hidden ([14](img/14-image-page-wide-composer.jpg) shows the full width). |
| Price | A **Pricing ⓘ** hover opens "Cost Details" ([17](img/17-image-cost-details.jpg)), and Generate shows ✦cost live (video: 84 → 105 when the duration changes from 4 s to 5 s). |
| Generate | **Charges credits immediately**. It appends a feed card with a spinner and **⊘ Terminate generation**. The toast says *"Successfully created an image generation task"*. The composer **keeps** the prompt and references so you can iterate. |
| Persistence | The feed persists across reloads; the composer state does not. |
| Explore / History dock | A right panel with search "Prompt keywords", Time ▾, Generation type ▾ and a masonry grid ([1F](img/1F-image-page-history-side-panel.jpg)). At 1071 px it renders **off-screen** (layout bug). |

### 2.1 Feed card actions

| Action | Detail |
|---|---|
| ✎ Re-edit | Loads that run's prompt, references and params back into the composer |
| ↻ Regenerate | Same params, new run |
| 🗑 | Delete the run |
| Hover result → ⋯ | **Video Editing** (New) · **Draw** · **Collect** · **Download** · **Share link** · **Delete** ([22](img/22-feed-result-more-menu.jpg)) |
| Adv Params ⓘ | Hover shows that run's advanced values |
| Click result | Opens the **artwork detail** modal (§2.2) |

### 2.2 Artwork detail modal — [20](img/20-artwork-detail-modal.jpg)

- **Left:** the preview, with × close, zoom −/slider/+, **Image/Video only mode**, **Comparison mode**, ⋯ (Share link, Delete) ([21](img/21-artwork-detail-more-menu.jpg)), download and ☆ favourite.
- **Right:**
  - author, views and likes
  - model, the prompt (with chips) and parameter chips
  - the full parameter table, including the **actual seed used** (e.g. 1041981156)
  - "Generated on …"
  - a big **✦ Clone & try** button
- **Far right:** a vertical filmstrip of other history items, for paging through them.

---

## 3. Image page

### 3.1 Models — [12](img/12-image-model-picker.jpg)

The picker is titled "Picture model": cards with an icon, name, one-line pitch and a ✓ on the selected one.

| Model | Pitch (verbatim) | Visible inputs (standalone schema) |
|---|---|---|
| **Seedream 5.0 Pro** (default) | Fine-tune position and colors, separate layers, and keep more of the original texture | prompt, `min_ratio` 0.07–16, `max_ratio`, `cot_mode` enabled/disabled, size (custom; 1024×1024 or area 1k/2k), img, seed; hidden: use_pre_llm, **origin_img, annotation_info** |
| GPT Image 2 (Beta) | High-fidelity images with built-in reasoning | prompt, quality **low**(default)/medium/high, image_size 1024²(default) … 3840×2160, img |
| Seedream 5.0 Lite | Strong prompt alignment, native 2K output, 4K upscaling, and real-time web search | prompt, force_single, seed, min/max_ratio, cot_mode, **close_search** (web search toggle), allow_llm_fallback, width/height 2048, img |
| Nano Banana 2 (Beta) | Conversational image editing with strong character consistency | prompt, aspect 16:9…1:1, 1K/2K/4K, img |
| Nano Banana Pro (Beta) | Accurate text rendering with high-fidelity 4K output | same as Nano Banana 2 |
| Seedream 4.5 | Consistent results, refined portraits, and solid for commercial use | prompt, width/height 2560, seed, image_offset_end 1–15, force_single, optimize mode, img |
| Seedream 4.0 | Unified image generation and editing, with multi-image references and batch creation | prompt, negative "nsfw", width/height, size enum 1–16 MP, PE flags, guidance/cfg weights, img |
| Seedream 3.0L (Art Edition) / 3.0L | Art-focused … CoT and PE variants / Fast text-to-image, native 2K output, accurate text rendering | prompt (≤2000), llm_seed, PE, negative, seed, scale, width/height 1024, i2i_strength, steps; **sub_task_count 4** (4 images per run) |

Defaults **differ from the canvas**: GPT Image 2 is quality low / 1024² here and medium / 2048×1152 on the canvas. The two products use different schema sources: "model-center" models here versus the canvas catalogue.

### 3.2 Composer chips (Seedream 5.0 Pro)

| Chip | Popover |
|---|---|
| **Function** "Universal Reference ▾" | Universal Reference ✓ / **Layer separation** (= model `…-5.0-pro-i2l`) ([13](img/13-image-function-universal-vs-layer.jpg)). Switching to Layer separation did **not** apply while the reference had an annotation. |
| **▢ 1:1** | "Ratio adjustment" + Reset: ratio grid 16:9 · 3:2 · 4:3 · 1:1 · 3:4 · 2:3 · 9:16 · **Custom**; "Image size" W ⟷ H (1024); an **image area** toggle (1k/2k) with the warning *"The scale will fail when turned on."*; size tip *"The resolution (area) … will take precedence when filled in with the width and height"* ([15](img/15-image-ratio-adjustment.jpg)) |
| **⇄** | "Adv Params" + Reset showing **raw field names**: `min_ratio` slider (0.07), `max_ratio` (16), `cot_mode` select, `seed` (−1) ([16](img/16-image-adv-params-raw-names.jpg)) |
| **Pricing ⓘ** | Cost Details: input images — first 0, 2+ 0.3 credit/image; output — ≤2.36 MP 9, >2.36 MP 18 credits/image ([17](img/17-image-cost-details.jpg)) |

Composer form definition (`props.schemas`): `__checkpoint` "Basic model", `__operation_type` "Operation", `__size` "Size" (`format: custom`, default 1024×1024, area enums 1k/2k, dimensions 1024–2048). Everything else comes from the model schema.

### 3.3 Generation run (tested) — [1C](img/1C-image-prompt-with-inline-ref-chip.jpg), [1D](img/1D-image-generating-feed-item-terminate.jpg), [1E](img/1E-image-result-in-feed.jpg)

- **Inputs:** a library fox photo as the reference, plus the prompt `@Image001 as a cute 3D clay figurine sitting on a coffee cup, studio lighting`.
- **On submit:** the balance dropped by 9 at once. The new feed card shows the chips "Seedream 5.0 Pro | Reference images | Proportion 1:1 | Adv Params", a spinner and Terminate.
- **Result:** came back after about 90 s, keeping the identity of the reference.

### 3.4 Draw / Artboard (region editing) — [23](img/23-draw-artboard-modal.jpg), [24](img/24-draw-region-annotation-at-mention.jpg), [25](img/25-draw-prompt-with-region-chip.jpg), [26](img/26-region-edit-generating-toast.jpg), [27](img/27-region-edit-result-beret.jpg)

You can open it from a result's ⋯ → Draw, or from the banner *"Edit reference images directly with Artboard! [Draw to edit]"*.

| Part | Detail |
|---|---|
| Header | "Draw", *"Automatically saved at Just now"*, × |
| Tool rail | **"Mobile annotation"** (hand/move; a mistranslation of "move annotation"), **Dot mark**, **Rectangle selection**, **Brush**, **Arrow**, Undo, Redo |
| Zoom | + 100% − and fit |
| Canvas | The image, with annotations drawn on top. A rectangle gets a green box, a label pill **"Region01"**, 8 handles and a × |
| Mini composer | Reference thumbnail (+), prompt, 1:1, ⇄, Pricing, Generate ✦9 |
| `@` menu | Group **Image001 ▾** → Image001, **Region01**; plus Color selection |
| Run | The modal closes, a toast appears, and the feed card chip reads "Image001 · Region01". The composer reference shows an **annotation badge**. Hidden schema fields `origin_img` + `annotation_info` carry the marks. |
| Result | "@Region01 add a tiny red beret on the head, keep everything else unchanged" → **only the head changed** (about 40 s, 9 credits) |

---

## 4. Video page — Creation mode

### 4.1 Composer — [30](img/30-video-page-feed-composer.jpg)

`[+ material]` · placeholder *"Describe the video scene you want to generate"* · footer `[AI Video ▾] [⬡ Seedance 2.5] [▣ Adaptive] [480p] [4s] [🪄] [Creation mode | ✦ Director mode] [✦ 84]`

| Chip | Behaviour |
|---|---|
| Material | Menu: local upload · material library · **Portrait Gallery** · **3D Director's Desk** |
| Model | Cards with pitch and **promo badges** ("Up to 86% off" 2.0 Mini, "Up to 74% off" 2.0 Fast) ([31](img/31-video-model-picker-discount-badges.jpg)) |
| Adaptive / 480p / 4s | One **"video settings"** popover: Aspect Ratio tiles (Adaptive, 1:1, 3:4, 4:3, 9:16, 16:9, 21:9), Resolution (480/720/1080p, options per model), Duration slider. **No Smart Duration** here, unlike the canvas ([33](img/33-video-settings-popover.jpg)) |
| 🪄 | **One-click prompt optimization** (§5.5) ([32](img/32-video-wand-prompt-optimization-tip.jpg)) |
| Generate | Live price, e.g. Seedance 2.5 480p: 4 s = 84, 5 s = 105 (21 credits/s) |

### 4.2 Video catalogue (23 entries = model × task)

Each entry has `task_type` / `inference_type`, `max_prompt_length`, `support_batch_flow`, and `schema = { config_schemas, advance_config_schemas, input_schemas }`.

| Task | Meaning (UI name) | Models |
|---|---|---|
| `t2v`, `r2v` (x2v) | text / multimodal reference → video (**Freestyle Creation**) | Seedance 2.5, 2.0, 2.0 Fast, 2.0 Mini |
| `f2v` (flf) | first + last frame (**Multi-frame Editing**) | 2.5, 2.0, 2.0 Fast, 2.0 Mini, 1.5 Pro, 1.0 Pro |
| `edit` | edit an input video (**Video Editing**) | 2.5 |
| `ev` | **Extend Video** | 2.5, 2.0, 2.0 Fast, 2.0 Mini |
| `i2v`, `t2i2v` | legacy image→video, text→image→video (**Image/Text To Video**) | 1.5 Pro, 1.0, 1.0 Fast |
| `motion` | **DreamActor 2.0**, motion mimic (1 image + 1 driving video ≤ 30 s) | DreamActor 2.0 |

Key fields:
- `prompt` ≤ 15 000 characters (2.5), ≤ 5 000 (2.0 family) or ≤ 500–4 000 (legacy).
- `resolution`: 480p default; 2.0 also offers 1080p and 4k.
- `frames`: 97–721 for 2.5 (4–30 s) and 97–361 for 2.0 (4–15 s), stored as **24·s + 1** with a `frames_to_duration` transformer.
- `aspect_ratio`: adaptive by default, described as "Automatically generate the appropriate aspect ratio based on the prompt".
- Advanced: `seed` "Result Similarity (Seed)" and `with_audio` (on by default).
- Legacy advanced: `creative_rephraser` with the raw pinyin values `kuoxie` / `chuangkuo` (untranslated), and `camerafixed`.

**Reference constraints (`mm`)** are shipped per model:

| Model | Images | Videos | Audio |
|---|---|---|---|
| Seedance 2.5 (r2v / edit / ev) | ≤ 30 (png/webp/jpg/gif/heif/heic, ≤ 30 MB, 300–6000 px, aspect 0.4–2.5) | ≤ 10 (mp4/mov, ≤ 200 MB, 480p–4k, 1.8–30.2 s total) | ≤ 10 (wav/mp3, ≤ 15 MB, 1.8–30.2 s total) |
| Seedance 2.0 Mini (r2v) | ≤ 9 | ≤ 3 (≤ 1080p, 2–15.2 s) | ≤ 3 (2–15 s) |
| f2v | first/last images only, required | — | — |
| DreamActor 2.0 | 1 (≤ 10 MB), required | 1 (≤ 2k, ≤ 30 s), required | — |

Seedance 2.5's 30 + 10 + 10 is the "50 references" in the marketing copy.

---

## 5. Video page — Director mode (timeline composer)

### 5.1 Layout — [34](img/34-video-director-mode-timeline-tooltip.jpg), [39](img/39-director-two-tracks-shot-and-sound.jpg)

Tooltip: *"Director mode: Use the timeline to precisely arrange multiple shots, material references, shot durations, and audio tracks, suitable for complex video structures."*

```
[+ material]
Camera timeline  (Transcribe to creative mode)   👁 Video rhythm preview   − ●── + 100%
 0s        1s        2s        3s        4s
 ▶ │Shot 1 · Plain text 0–1s│Shot 2 · 1–2s│              (+)
   Voice timeline                                          remove
 ♫ │Sound · Text sound 0–1s│                               (+)
▸ Voice, style, and more controls (optional)
   Overall visual style [...]   Avoid occurrence of [...]   ♫ Voice timeline [Add]
[AI Video] [model] [ratio] [res] [dur] [🪄] [Creation | ✦Director] [✦ cost]
```

### 5.2 Shots (camera track)

- **Empty state:** *"add a scene first, then write what happens"* [+ Add the first scene].
- **Scene type menu** ([35](img/35-director-add-scene-type-menu.jpg)): **Text generation · First frame generation · First & Last Frame to Video · Grid image split · Multi-Image References · Video Reference**.
- **Shot card** ([36](img/36-director-shot1-card.jpg)):
  - header "Shot N · <type> · 0–1 s"
  - an editable prompt (*"Describe this shot; you may input @ to reference materials"*)
  - **left/right drag handles** for duration (hint *"drag the camera to arrange the rhythm, pull both sides to adjust the duration"*)
  - trash on hover
  - a "+" after the last shot to append (each new shot defaults to 1 s)
  - ▶ at the track head to preview
- **Video rhythm preview** (hover the ruler): a mini player showing the time, and *"blank period — no preview available at current time"* over gaps ([3A](img/3A-director-rhythm-preview-blank-period.jpg)).

### 5.3 Voice track and global controls — [37](img/37-director-global-style-avoid-voice.jpg), [38](img/38-director-voice-timeline-add-segment.jpg)

- **Overall visual style**: placeholder *"For example: realistic film texture, warm backlight"*.
- **Avoid occurrence of**: prefilled *"Avoid screen flicker, distorted characters, and abrupt camera cuts"*.
- **Voice timeline [Add]**: adds a second track (with a remove link). Each segment is either **Text describing sound** or **Upload audio file**. A segment card reads "Sound · Text sound · 0–1 s" (*"Write music, dialogue, or sound effects; you may input @"*).

### 5.4 Compilation ("Transcribe to creative mode") — [3B](img/3B-director-transcribed-to-creation-structured-prompt.jpg)

The timeline is serialised into the Creation-mode prompt:

```text
Duration: 4 s
Visual Development:
0 s~1 s: A clay fox yawns and wakes up inside a coffee cup
1 s~2 s: The fox stretches, then happily sips coffee, camera slowly pushes in
Music Development:
0 s~1 s: soft cozy acoustic guitar, gentle steam hiss
Prohibited content: Avoid screen flicker, distorted characters, and abrupt camera cuts
```

Creation and Director modes keep **separate state**: switching back shows each mode's own content.

### 5.5 One-click prompt optimization (🪄) — [3C](img/3C-wand-one-click-optimization-dialog.jpg), [3D](img/3D-wand-optimize-result-naive-split-9-shots.jpg)

- **Dialog:** *"Lumina will split the existing content into clear, draggable, and adjustable-duration video clips."* It warns before overwriting an existing timeline.
- **Options:**
  - **Text-only optimization**: split into scene descriptions, faster.
  - **Automatically generate keyframes**: split scenes, generate grid keyframes, and place them on the timeline.
- **Cost:** shown via ⓘ as LLM pricing, 0.1 / 0.6 credits per 1K tokens.
- **Observed:**
  - Running it on the compiled prompt produced **9 shots split naively by line and comma**, each with the suffix "，Subject's actions develop further".
  - The duration went from 4 s to 5 s and the price from 84 to 105.
  - The balance didn't change, which points to a rule-based fallback.
  - So round-tripping Director → Creation → Optimize **corrupts the structure**.

---

## 6. AI Apps — the "box" layer

### 6.1 App Library — [40](img/40-ai-apps-library.jpg)

"App Library" has a search box, a hero carousel, tabs **All / Video / Image**, and cards (cover, name, two-line description).

| App | Type | Cost / run | Model | Graph (node types) |
|---|---|---|---|---|
| AI Photo Editor | Image | 3.5 | Seedream 5.0 | PrimitiveString ×2 → BALLMImage ← LoadImage → SaveImage |
| AI Clothes Changer | Image | 3.5 | Seedream 5.0 | LoadImage ×2 → BALLMImage → SaveImage |
| Image Edit Seedream 5.0 Pro | Image | 9 | Seedream 5.0 | LoadImage → Resize → GetImageSize → StringFunction → BALLMImage(size) ; String → prompt → SaveImage |
| AI Photo Enhancer, AI Background Generator, AI Muscle Filter, AI Anime Photo | Image | 9 | Seedream 5.0 | resize/size pipeline + BALLMImage |
| AI Meme Maker | Image | 9 | — | 5 × multiline strings + string functions → BALLMImage |
| iPhone Wallpaper Maker | Image | 9 | Seedream 5.0 | **RandomSelectMultiLineText** (random style) → BALLMImage |
| Anime Character Creator, AI Emoji Maker | Image | 9 | Seedream 5.0 | prompt (+image) → BALLMImage |
| Esports Logo Maker | Image | 10 | Seedream 5.0 | **BALLMText** (prompt writer) → BALLMImage |
| AI Spritesheet Maker | Image | 25 | GPT Image 2 | prompt + image → BALLMImage |
| AI Peel Effect | Video | 100 | Seedance 2.0 | prompt + image → BALLMVideo |
| AI Pole / Jiggle / Twerk Dance | Video | 152 / 180 / 190 | Seedance 2.0 | LoadImage + **LoadVideo (driving)** → GetVideoComponents → BALLMVideo → **BAVideoMergerNode** → SaveVideo |
| IDog New Launch | Video | 300 | Seedance 2.0 | image + prompt + **LoadAudio** → BALLMVideo → merger |
| AI Influencer Look Generator | Video | 300 | Seedance 2.0 | **BALLMText** → BALLMVideo |
| AI UGC Ad Maker | Video | 450 | Seedance 2.0 Pro | image + prompt → **BALLMText ×2** (expert system prompt) → BALLMVideo (720p, 15 s) → SaveVideo |

### 6.2 App runner — [41](img/41-ai-app-image-edit-form.jpg), [42](img/42-ai-app-ugc-ad-maker-form-demo.jpg), [43](img/43-ai-app-ugc-demo-carousel.jpg), [44](img/44-ai-app-adv-params-ratio.jpg)

- **Layout:**
  - "‹ Return", the H1 name and the description.
  - Left: a **form card** with an image upload (*"Images must be in png, jpeg, jpg, or gif format and no larger than 20MB"*), a prompt textarea, a chip naming the workflow, **⇄ Adv Params** (only when advanced slots exist) and a primary **"✦ 9/time"** button.
  - Right: an **output panel**, which shows a looping **demo carousel** ‹ › before the first run.
- **Copy bug:** the video app's textarea placeholder still says "Describe the image you want to generate".

### 6.3 App data model (from the page state)

```jsonc
{
  "id": "630304727334180011", "name": "Image Edit Seedream 5.0 Pro", "tags": ["Image"],
  "publish_as_app": true, "access_control": "open", "cost_count": 9,
  "base_models": ["seedream5.0"], "execution_stat": { "p75_duration": 47.08, "success_rate": 0.99 },
  "statistic": { "views": 777, "likes": 0 }, "revisions": { "1": {...}, "4": {"data_id": "…"} },
  "data": {                                   // the canvas graph, ComfyUI-style
    "nodes": [ { "id": "2", "type": "LoadImage", ... }, { "id": "1", "type": "BALLMImage", ... }, ... ],
    "links": [ ["1","2","IMAGE","1","image",{"type":"IMAGE"}], ... ],
    "ba_extra": {
      "slot_info": {
        "inputs": [
          { "name": "image",  "format": "image_upload", "extra": { "node_id": "2", "input_key": "image", "class_type": "LoadImage", "ui_order": 0 } },
          { "name": "Prompt", "format": "input", "props": { "limit": { "enable": false } },
            "extra": { "node_id": "4", "input_key": "value", "class_type": "PrimitiveString", "ui_order": 0 } }
        ],
        "outputs": [ { "name": "images", "format": "image", "extra": { "node_id": "3", "output_key": "images", "class_type": "SaveImage" } } ]
      },
      "slot_info_schema": { "input": { "$schema": "draft-07", "properties": { "image": {...}, "Prompt": {...} } }, "output": {...} },
      "prompt": { "1": { "class_type": "BALLMImage", "inputs": { "prompt0": ["4",0], "image0": ["2",0], ... } } }  // compiled
    }
  }
}
```

- **Slot placement:** `ui_order` 0 puts a slot on the main form; ≥ 100 (e.g. AI UGC Ad Maker's **Ratio** select at 106) puts it under **⇄ Adv Params**.
- **Pinning:** on the canvas, a node's `extra.pinList: ["ratio"]` marks a parameter as pinned for exposure.
- **Demo state:** apps ship the graph with the last demo results inside node `extra` (prompt, respJson, status).

---

## 7. Canvas node vs standalone page vs app

| Concern | Canvas node (part 1) | Standalone Image/Video page | AI App |
|---|---|---|---|
| Unit | Node in a graph | One run in a feed | Fixed graph behind a form |
| Inputs | Edges + chips + `@` | Reference slot + `@` chips (Image001, Region01) | Only the exposed slots |
| Params | Model schema; placement decided by the client | `config_schemas` vs `advance_config_schemas` from the backend | Exposed slots only (`ui_order`) |
| History | Overwrites the node; global gallery | **Feed = history**, Re-edit / Regenerate / Clone & try | Output panel (+ history) |
| Region edit | Image tools (Repaint, Erase…) | **Artboard annotations → Region chips** | Baked into the graph |
| Multi-shot video | Separate nodes + editor | **Director timeline → structured prompt** | Baked (e.g. LLM writes the prompt) |
| Cost | Per node, Billing hover | Generate ✦N, Cost Details, promo badges | Fixed "✦ N/time" |
| Charged | At run | At submit (immediately) | At run |

---

## 8. Rough edges (don't copy)

| # | Issue |
|---|---|
| 1 | Footer chips clip at ~1070 px and the Explore/History dock renders off-screen (no responsive fallback) |
| 2 | Adv Params show raw keys (`min_ratio`, `cot_mode`) and pinyin enums (`kuoxie`, `chuangkuo`); "Mobile annotation" mistranslation |
| 3 | Wand optimisation on structured text splits naively, appends Chinese-punctuated boilerplate, and changes duration and cost silently |
| 4 | Default params differ between the canvas and standalone pages for the same model |
| 5 | Layer separation can't be selected while a reference carries annotations, with no message |
| 6 | The video app placeholder says "image" |
| 7 | Composer state is lost on reload |
| 8 | Credits are charged at submit with no confirmation for expensive runs (apps up to 450/run) |

---

## 9. Implications for zcanvas

| Lumina idea | Proposal for zcanvas |
|---|---|
| Backend-split schema (`config_schemas` / `advance_config_schemas` / `mm`) | Registry v2: per model, `params[]` with `placement: inline | advanced | hidden`, plus `inputs.constraints` per kind (max count, formats, size, dimension, aspect, duration). The canvas node panel and any standalone composer render from the same data. |
| Reference tokens (`Image001`, `Region01`) | Name incoming references automatically and let the prompt hold structured tokens `{ref: nodeId|assetId, region?: box}`. Annotations are saved alongside the asset. |
| Artboard | P1: an annotate-image modal (rect / dot / brush / arrow). Regions become prompt tokens; the job payload carries `origin_img + annotation_info`. |
| Director timeline | P1 inside the Video node panel: shots (type, text, duration), voice segments, style and avoid fields. Compile to a structured prompt (keep the compiler deterministic and testable). Show a rhythm preview and flag gaps. |
| Feed as history | Give each node a **run history list** (prompt, params, seed, result, Re-edit / Regenerate / Clone), which fixes part 1's "overwrites result". |
| Detail modal with real seed + Clone & try | Show the resolved params and seed of each output, and add "Clone to new node". |
| AI App = published workflow + slot_info | This matches our templates (`meta.template.inputs`). Extend it to `{nodeId, paramKey, format, placement, order, label}`, add outputs (`nodeId, port`), a JSON Schema export, `cost` (estimated from the registry), `stats` (p75, success rate) and revisions. Offer a **"Publish as app"** form runner page. |
| Price at submit | Show the estimate on the run button, plus a confirmation above a threshold. Charge on job start and refund on failure (we're on mock credits now, so design the ledger accordingly). |

### Backlog additions (on top of part 1)

- **P0 R1 — Schema v2 placement and input constraints** in contracts. The node panel renders inline vs advanced from data.
  - Done when: an upload that violates a constraint is rejected with the specific limit named.
- **P0 R2 — Per-node run history.** A list of runs with params and seed, plus Re-edit, Regenerate, Delete and "use as current".
- **P1 R3 — Reference tokens** (`@Image00n`, colour tokens) stored structurally, not as plain text.
- **P1 R4 — Annotation modal** (rect / dot / brush / arrow) producing region tokens.
- **P1 R5 — Video timeline composer** with a deterministic compiler and a round-trip test (timeline → text → timeline stays the same).
- **P1 R6 — Publish template as app.** Slot mapping (`nodeId`, `paramKey`, `format`, `order`, `placement`), an output mapping, a form runner page, and a fixed cost estimate.
- **P2 R7 — Standalone composer page** (Image/Video) that reuses the node panel component and writes runs into a scratch canvas.

---

### Image index

| Range | Topic |
|---|---|
| 00–03 | Home, sidebar flyouts |
| 10–1F | Image page: composer, popovers, library, run, History dock |
| 20–27 | Detail modal, result menu, Artboard region edit |
| 30–33 | Video Creation mode |
| 34–3D | Director mode, transcription, wand optimisation |
| 40–44 | AI Apps: library, app forms, demo, Adv Params |
