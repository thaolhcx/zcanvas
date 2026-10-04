# Raw notes (working file, Lumina exploration 2026-10-02)

## Platform facts
- URL: https://ai.byteplus.com/lumina/en/canvas/<canvasId>; canvas UI lives in same-origin iframe /lumina/en/canvas-iframe/<id>
- Built on React Flow (@xyflow/react v12: classes react-flow__*, xyflow__viewport). All nodes rfType "baNode"; data.type = BALLMText | BALLMImage | ...
- Node data shape: {type, title, inputs[{name,label,type STRING|IMAGE|VIDEO|AUDIO, format:'slot' | value}], outputSlots[{name,type,label}], extra{status, model, modelConfig{param:{value,switch}}, user_prompt(slate JSON), prompt, output_preview_names, uiHeightMap}, runtimeInfo}
- Canvas persisted as "comfyui-ecology workflow" (GET /api/comfyui-ecology/workflow/<id>), source simple_canvas, revisions. Autosave (cloud icon in top bar; reload keeps text).
- Pricing = /api/cost_center/measure_configs (credits "lumi/computing_points"), per scene expression rules.
- Scroll wheel = pan (panOnScroll); zoom via slider bottom-left (shows % tooltip, e.g. 63%); drag on empty pane = marquee select.

## Pricing rules (credits)
- ai_audio_generation: Seed-TTS = ceil(chars/125)*0.5 ; Seed-Audio = ceil(duration_s)*0.25
- ai_video_generation: Seedance 2.0 pro no-ref = frames*res{480p14,720p30,1080p75,4k156}; with ref video = (frames+inputVideoDur)*res{480p9,720p19,1080p46,4k93}; Seedance 2.5 (frames+inVidDur)*res; Seedance 2.0 mini/pro-fast tier-based; MiniMax-H3 (frames+inImgCnt)*res{768P14,2K23}+(inVidDur>5?(d-5)*6:0); MiniMax-H3-Max frames*res{480P10,768P14}; WAN 3.0 (frames+inVid)*res{480 10,720 20,1080 40}; DreamActor 2.0 frames*8; Seedance 1.5 Pro frames*{480p 1/2(audio),720p 3/5,1080p 6/12}; Seedance 1.0 Pro frames*{3,5,12}|{2,4,9}; Unified Video 1.0 frames*10; OmniHuman-1.5 frames*18   ("frames" here is billed unit, likely seconds)
- ai_picture_generation: Seedream 5.0 Pro ≤2.36MP = n*9 + (refImgs-1)*0.3 ; >2.36MP = n*18 + ...; layer separation flat; Nano Banana Pro n*{1K 12,2K 12,4K 24}; gpt-image2 low {1..7}/medium{8..60}/high{30..230} per image by size
- ai_chat: token based (prompt+completion tokens); gemini image variants.

## Text node (BALLMText) — "Text Generation"
- Menu desc: "Scripts, advertising words, brand copy"
- inputs: text:STRING slot, image:IMAGE slot, video:VIDEO slot, audio:AUDIO slot, model, user_prompt ; output text:STRING
- initial size 300x320; extra.uiHeightMap.preview 318
- Empty state: "Try..." + 3 quick actions: Write or paste text | Elaborate | Ask about an image
- Write mode: title -> "Write or paste text", body textarea (arco-textarea, placeholder "Start your creation..."), tooltip "Double click to edit" (single click selects, dblclick edits). Stored in extra.prompt; status 0.
- Toolbar above node when selected & has content: Download, Fullscreen
- Prompt panel under node (when selected): slate-like editor "Please enter a prompt word, use @to introduce multimodal output", expand icon (top-right), model chip, "1×" count, Billing (credits estimate) chip, Send button
- Model popover: model select + "parameter": Thinking mode (false/true), Maximum response length (toggle+slider+number, default 4096, 1..256000), Seed (-1), system prompt (toggle + textarea "Please enter a system prompt word")
- Models: Seed 2.1 turbo (default), Seed 2.0 pro, Seed 2.0 lite, GPT 5.5, Gemini 3.0 flash, Gemini 3.1 pro preview, Gemini 3.1 flash lite preview, Seedream-PE-250815 ; capability icons after each name (image/video/audio input)
- modelConfig persisted: thinking{value,switch}, max_tokens{4096,switch}, seed{-1,switch}, system_prompt{"",switch}
- Params are schema-driven per model (model.schema[] {name,type,format,default_value,props{enums,min,max,required},tips,visible}); system prompt toggle is a UI extra on all LLMs.
- Text model catalog (key, input types, visible params):
  - Seed 2.1 turbo [ByteDance-Seed-2.1-turbo] in text,image,video: thinking(disabled|enabled, default disabled shown "false"), max_tokens 4096 (1..256000), seed -1
  - Seed 2.0 pro [ByteDance-Seed-2.0-pro] in text,image,video: thinking, max_tokens 4096 (1..32000), seed
  - Seed 2.0 lite [ByteDance-Seed-2.0-lite] same as 2.0 pro
  - GPT 5.5 [gpt-5.5-2026-04-24] in text,image: max_tokens (1..32000), reasoning_effort "Inference Strength" none|low|medium|high|xhigh (medium), verbosity "Lengthiness" low|medium|high (medium), seed
  - Gemini 3.0 flash [gemini_3f] in text,image,video: max_tokens, temperature 0..1 (1), top_p 0..1 (1), seed (0)
  - Gemini 3.1 pro preview [gemini-3.1-p] in text,image,video,audio: same as Gemini 3.0 flash
  - Gemini 3.1 flash lite preview [gemini-3.1-fl] in text,image,video,audio: same
  - Seedream-PE-250815 in text,image,video: thinking disabled|enabled|auto, max_tokens 1..12288
- Capability tags in model list: image-01 (image understanding), play-circle (video), recording-03 (audio)
- Count selector "1×" → 1×,2×,3×,4× (batch runs)
- Billing chip hover: per-model price. Seed 2.1 turbo: input 0.1 credit/1K tokens, output 0.5 credit/1K tokens. GPT 5.5: input 1, output 6 credits/1K tokens.
- Run: send button → becomes stop button, tooltip "Cancel build". Success toast top: "Generated successfully, time-consuming 0 hours 0 minutes 4 seconds". Node header gets "⏱ 4.1s" badge. Header right icon tooltip: "Running the current Node requires credits."
- IMPORTANT behavior: the node's own existing text is NOT sent as context; prompt panel text (+ upstream @refs) is the input. Output REPLACES the node content (extra.prompt). No in-node version history.
- status codes: -1 = empty/new, 0 = has manual content / configured, 2 = generated success (1 presumably running, 3 failed)
- modelConfig keeps params from previously selected models (merge, not reset)
- Fullscreen (toolbar) → full-page editor titled "User Prompt" with "Exit Fullscreen" and "Copy"; editable.
- Prompt panel expand icon → full-screen dimmed overlay editor with collapse icon.
- "@" with no upstream connections → no popup.
- Output "+" handle (right) click → "Add Node" menu filtered by compat: Text, Image, Audio, Video, Sticky Notes, Script Planning, Interactive Film And Television. Picking creates node to the right (+~560px x), auto-connected (bezier edge), new node selected & its prompt panel opens.
- Edges: type baEdge, sourceHandle/targetHandle "ba-amass" (single generic handle per side, not per-port), data.runtimeInfo.animation true, zIndex 5.
- Downstream node caches upstream text in extra.inputTexts [{edgeId, handler, nodeId, values[]}]; prompt panel shows upstream as chip "T Write or paste text ×" above editor.

## Image node (BALLMImage) — "Image Generation"
- Menu desc: "Promotional graphics, posters, covers"
- inputs: prompt:STRING slot, image:IMAGE slot, user_prompt, model ; output image:IMAGE ; initial 300x100(auto height)
- Empty state: "Try..." + Upload image | Image-to-image
- When created downstream of text: body = checkerboard placeholder at aspect of size (16:9 for 2048x1152), default model GPT Image 2; when created from blank canvas default was Seedream 5.0 Pro (default = last used?)
- Panel footer chips: [model] [Panorama] [2048x1152 size] [Camera off] [Advanced Parameters] [1×] [Billing] [Send]
- Model list (11; SeedEdit 3.0 greyed-out/disabled in this context, needs image input):
  - GPT Image 2 [gpt-image-2] t2i,i2i,image_r2v multi-ref: n 1..10, quality low|medium|high (medium), image_size 1024x1024|1536x1024|1024x1536|2048x2048|2048x1152(def)|3840x2160|2160x3840, panorama bool, custom_camera dict {camera "Arricam LT", lens "Hawk Class X", focal "125mm", aperture "f/1.4"}, prompt ≤32000
  - Seedream 5.0 Pro Layer Decomposition [..-i2l] i2l (image→layers), 1 image: size 1k|2k|auto, output_format jpeg|png, watermark, seed
  - Seedream 5.0 Pro [ByteDance-Seedream-5.0-pro] multi-ref: size (dimensions or area 1k|2k; 512–2048), output_format jpeg|png, watermark, seed
  - Seedream 5.0 Lite: sequential_image_generation auto|disabled ("group image"), max_images 1..15, size, output_format, watermark, seed
  - Seedream 4.5: negative_prompt, size, seed, sequential_image_generation, max_images 1..15, watermark, optimize_prompt_options_mode standard|fast
  - Nano Banana Pro (Beta) [gemini_nbp]: image_size 1K|2K|4K, aspect_ratio 16:9|9:16|4:3|3:4|1:1|(auto), custom_camera
  - Nano Banana 2 (Beta) [gemini-3.1-fi]: max_tokens, prompt ≤800, aspect_ratio 1:1|2:3|3:2|3:4|4:3|4:5|5:4|9:16|16:9|21:9|auto, imageSize 1K|2K|4K, custom_camera
  - Seedream 4.0 [high_aes_general_v40s] up to 14 ref imgs: negative_prompt "nsfw", width/height 2048, seed, use_pre_llm, guidance_scale 1..10 (3), many cfg weights
  - SeedEdit 3.0 [seededit_v30_common] i2i only, 1 image: scale 0..1, guidance_weight 2..5, guidance_weight_image 1..1.25, temperature
  - Seedream 3.0L (Art Edition) / Seedream 3.0L: t2i/i2i single image; width/height 1024, scale 1..10, i2i_strength 0..1, ddim_steps, req_schedule_conf std|poster
- UI splits model schema into: inline chips (format size-adjust → "2048x1152" chip; custom-camera → "Camera off/on" chip; panorama boolean → toggle chip "Panorama") and "Advanced Parameters" popover (n "Num" 1..10, quality low|medium|high for GPT Image 2). Mapping depends per model.
- Panorama chip = toggle (highlighted when on) → modelConfig.panorama {switch:true,value:true}
- Size chip → popover "proportional adjustment" with "reset", "Size ⓘ", tiles with aspect icons: 1024x1024, 1536x1024, 1024x1536, 2048x2048, 2048x1152, 3840x2160, 2160x3840 (horizontal scroll ›). initialValue {aspectRatio, customAspect:false}
- Camera chip → "Camera Control" large panel: 4 carousels (prev/next arrows, faded neighbours) + toggle (off="close") + Save
  - Camera: Arricam LT | ARRI Alexa 35 | ARRI Alexa 65 | ARRIFLEX 435 | IMAX Film Camera | IMAX Keighley | Panavision DXL2 | Sony Venice | RED V-Raptor
  - Lens: Hawk Class X | Cooke S4 | Cooke SF 1.8x | Cooke Speed Panchro | ARRI Signature Prime | Canon K35 | Helios | Panavision C-Series | Panavision Primo | Zeiss Ultra Prime
  - Focal: 8mm | 14mm | 24mm | 35mm | 50mm | 75mm | 125mm
  - Aperture: f/1.4 | f/4 | f/11
  - stored as custom_camera dict {camera,lens,focal,aperture}; schema skip_gen:true (UI-composed into prompt)
- Seedream 5.0 Pro chips: [model][size "2048x2048"/"1k"][Advanced Parameters][1×]. Billing hover "Billing instructions: Image Input Price 0–0.3 credit/image; Image Output Price 9–18 credits/image"
- Seedream size popover "proportional adjustment" (+reset): ratio tiles 21:9 16:9 3:2 4:3 1:1 3:4 2:3 9:16 9:21; "size [Free adjustment] W 2048 ⟷(link) H 2048"; "image area ⓘ" toggle → select (1k|2k) "Selectable after opening"; when area on, ratio+W/H disabled; chip shows "1k". modelConfig: custom_aspect, size, aspect_ratio, resolution
- Placeholder in node body follows chosen aspect (checkerboard), e.g. 16:9 → wide, 1:1 → square
- "@" mention menu (with upstream): lists upstream nodes (icon+title: "Write or paste text", "Image Generation") + "Color selection ›" (color picker: SV pad, hue slider, swatch, Hex/… dropdown, hex input, Preset Colors 2x12). Hovering a node item shows faded preview of its content. Clicking "Color selection" row inserts inline token "● #7BE188". Slate node {type:'ba-color', data:{color}}.
- Upstream connected nodes appear as chips above editor (removable ×) = all connected inputs auto-included; @ allows inline placement.
- Image run: node body → spinner "Generating"; global pill top-right "Generating 1/1" with progress border; send btn → stop with tooltip "Generating, cannot cancel" (image can't be cancelled; text could "Cancel build"). Result 54.9s Seedream 5.0 Pro 1k. Header badge "⏱ 54.9s". Upstream text was used by the image model (slogan text rendered in image).
- Image result stored extra.value = ["<uri://ba_resource?store_id=...&resource_type=image>"] ; status 2
- Selected image (with result) toolbar above node: Crop | Enhance | Draw | Multi-Angle | Layer Decomposition | [720▾: panorama generation, panoramic view] | [grid▾: 4-Panel storyboard, 9-Panel Storyboard, 25-Panel storyboard, Camera Movement Control, Scene Progression] | [light▾: 3D Relight, Lighting Correction, Cinematic Lighting, Cinematic Color Grading] | [#▾ split: 4 grid (2×2), 9 grid (3×3), 16 grid (4×4), 25 square (5×5), Custom ›] | [⋯: Character, Repaint, Erase, Expansion, Matting, Label, Camera Control] | Video Editor (scissors) | Download | Full screen preview
- Grid split step 2: "← Previous step" + "crop only — Create 4 image loading nodes" | "Create a storyboard grid — Create a storyboard and fill in 4 slices"; shows "Splitting..." then creates 4 BAFileLoad nodes "Grid slice 1..4" placed to the right in a 2x2 layout, NOT connected to source, all selected.
- Multi-selection toolbar: Typesetting ▾ | Download | Bypass | Save to Templates | Video Editor | Group | Generate
- BAFileLoad node (loaded/uploaded media): data {title, extra{type:'image', value:'<uri://ba_resource?store_id=..&resource_type=image>'}, inputs[file, type 'origin', txt, image, video], outputSlots[file:IMAGE]} initial 300x300
- Node context menu (right-click): Add to dialog box | Run subsequent nodes | Download | Copy ⌘C | Delete ⌫
- Bottom-left bar: Canvas Minimap | Grid Adsorption (snap toggle) | Hide Node Connections | zoom slider (% tooltip) | Quick Focus
- Fullscreen preview (lightbox): close ×, bottom bar: zoom out | slider | enlarge | Original size | Reverse rotation 90° | Clockwise 90° | download
- Crop: canvas auto-focuses/zooms to node; in-place crop frame with corner+edge handles and rule-of-thirds grid; top bar: cancel | ratio ▾ (original ratio ✓, customize, 4:3, 3:4, 16:9, 9:16) | confirm
- Enhance: inline bar above node replaces toolbar: Cancel | mode ▾ (Creative Upscale ✓, Lighting SR) | resolution ▾ (2k, 4k, 8k) | "Detail Intensity" 0..100 slider/input (50) | Billing (2K 3, 4K 6, 8K 12 credits/image) | Run
- Running Enhance creates a NEW BALLMImage node titled "Enhance" (model "Creative Upscale"), connected source→new, auto-placed in free space (below-right), canvas auto-pans to it; node shows "Generating" spinner; global pill "Generating 1/1".
  => Pattern: image "tools" = create derived downstream node pre-configured with a tool model (non-destructive), not in-place edit.

## Video node (BALLMVideo) — "Video Generation"
- Menu desc: "Promotion of video, animation, film"
- inputs: prompt:STRING, image:IMAGE, audio:AUDIO, video:VIDEO (slots), user_prompt, model ; output video:VIDEO ; initial 300x100
- extra.video_type: "r2v" (mode), modelConfig {content, duration, seed, is_flf, generate_audio, watermark}
- Empty state: "Try..." Upload video | Image-to-video | Combine images into a video | video raw video
- Panel: mode tabs row: "end to end frame" (first/last frame) | "omnipotent reference" (default active) | "video editing" (disabled w/o video input) | "video extension" (disabled w/o video input)
- Footer chips: [Seedance 2.5 ▾] [720p] [⏰ 5s] [Advanced Parameters] [1×] [Billing] [Send]
- Model dropdown (r2v mode) cards with subtitle "Supports multimodal video generation": Seedance 2.5, Seedance 2.0, Seedance 2.0 fast, Seedance 2.0 mini
- Full catalog (9):
  - Seedance 2.5 [Doubao-Seedance-2.5] t2v,i2v,flf,v2v,r2v,video_edit,video_extend,image_r2v: content(multi_model refs), resolution 480p|720p(def)|1080p, ratio 16:9|4:3|1:1|3:4|9:16|21:9|adaptive, duration 4..30 (5), seed, is_flf, generate_audio (true), watermark
  - Seedance 2.0 [Doubao-Seedance-2.0-pro] t2v,i2v,flf,v2v,r2v: resolution +4k, duration 4..15, frames 29..289 (25+4n), seed, is_flf, generate_audio, watermark, return_last_frame
  - Seedance 2.0 fast: 480p|720p, duration 4..15, frames, camera_fixed, return_last_frame
  - Seedance 2.0 mini: same as fast
  - Seedance 1.5 pro [ByteDance-Seedance-1.5-pro] t2v,i2v,flf: prompt, image_url, first_frame_image, last_frame_image, 480/720/1080p, ratio, duration 4..12, framespersecond, seed, camerafixed, watermark, generate_audio(false)
  - Seedance 1.0 pro i2v,flf: duration 2..12, frames ; 1.0 pro fast i2v ; 1.0 lite t2v (autocaption) ; 1.0 lite i2v
- Pricing (credits): Seedance 2.5 = (secs + inputVideoSecs) × res rate; Seedance 2.0 no-ref: secs × {480p 14, 720p 30, 1080p 75, 4k 156}; with ref video: (secs+refSecs) × {9,19,46,93}; 1.5 Pro secs × {480p 1|2 w/ audio, 720p 3|5, 1080p 6|12}; 1.0 Pro secs × {3,5,12}

## Audio node (BALLMAudio) — "Audio Generation"
- Menu desc: "Music, dubbing, sound effects"
- inputs: text:STRING, image:IMAGE, audio:AUDIO, video:VIDEO (slots), model, user_prompt ; outputs: audio:AUDIO, resp_json:STRING ("原始输出" raw output)
- extra.inference_type: ta2a | t2a | a2a | i2a ; extra.inputImages [{edgeId,handler,nodeId,values}] (like inputTexts)
- Empty (unconnected) state: body tall card "Try..." + "Upload audio"; when connected to image: body shows big audio placeholder icon
- Panel mode tabs: "ta2a" (text+audio→audio) | "Vincent Audio" (=t2a text-to-audio, mistranslated 文生) | "Audio Reference" (a2a) | "graphic audio" (=i2a image-to-audio, mistranslated 图生). Tabs shown depend on model's inference_types (Seed TTS → only "Vincent Audio").
- Placeholder: "Input text and convert it into realistic speech."
- Footer chips: [model] [♫ Tone Settings] [1×] [Billing] [Send]
- Auto model switch: when created from an image, tooltip: "The current model does not support the input images or audio, the model that supports the current input has been switched" → Seed TTS disabled (greyed) in list, Seed Audio chosen.
- Removing upstream chip "×" in panel ALSO deletes the edge (chips are a live view of connections).
- Models:
  - Seed TTS [Seed-TTS] t2a only: context_texts "Vibe Prompt" (≤500, e.g. "extremely happy"), pitch -12..12, text ≤5000, model seed-tts-1.1, voice_id (edited_select), format pcm|ogg_opus|mp3 (mp3), sample_rate 8k..48k (24000), bit_rate 16000|32000, emotion_scale 1..5 (4), speed_ratio -50..100, loudness_ratio -50..100 ; hidden: emotion, explicit_language
  - Seed Audio [Seed-Audio] ta2a,t2a,a2a,i2a: content(multi refs), pitch, text ≤5000, model seed-audio-1.0, format wav|ogg_opus|mp3 (wav), sample_rate (48000), speed_ratio, loudness_ratio
- Pricing: Seed-TTS = ceil(chars/125)×0.5 credits; Seed-Audio = ceil(seconds)×0.25 credits
- Tone Settings (Seed Audio): Speed rate, Volume, Pitch (slider+number), Model select, Format select, Audio sampling rate select
- Tone Settings (Seed TTS): "Voice tone ⓘ" card (avatar, name "Daisy", tags Entertainment ZH EN, swap ⇄ button), speed_rate, Volume, explicit language (Automatic recognition), "More parameters ›"
- Voice library popover "Official tone": filters All gender ▾, All ages ▾, search; scene chips: All scenes, General scenario, Fun accent, Role playing, Multilingual, Video dubbing, Audio reading, Teaching scene, Customer service scenario, Multi-emotional, British/American/Australian english, Japanese, Spanish, Beijing/Henan/Cantonese/Qingdao/Guangxi/Taiwanese/Sichuan/Changsha accent; voice cards (avatar with ▶ preview, name, tag): Daisy Entertainment, Gigi SocialMedia, Mabel Entertainment, Holly Entertainment, Opal Conversational, Esther Conversational, Nadia AudioBook, Quentin Dubbing, Cedric AudioBook, Magnus Dubbing
- Billing tooltip Seed TTS: "TTS Price 0.004 credit/characters"
- TTS run: "Cancel build" available; done in 2s; toast "Generated successfully, time-consuming 0 hours 0 minutes 2 seconds"; header "⏱ 2s"
- Audio result body: label "url" (raw generateResult name — UX bug), waveform (bars, played part highlighted, vertical playhead), progress scrubber, volume icon, play ▶, "00:00 / 00:05"
- Stored: extra.generateResult [{name:'url', value:'<uri://ba_resource?...&resource_type=audio>'}], extra.respJson (raw JSON with signed mp3 URL + store_id), modelConfig.voice_id 'zh_female_yuanqi_uranus_bigtts', explicit_language 'crosslingual'
- Audio selected toolbar: Trim | Video Editor | Download
- Trim: canvas auto-zooms; bar under node: × (exit) | mode icon w/ shortcut tooltip | waveform timeline with selection window (handles, duration label "00:01") | ✓ confirm
  - Shortcuts: ←/→ move selection; ↑/↓ expand/contract selection; I / O set in/out point; Esc exit; Shift+arrows exact mode 0.01s; ⌘/Ctrl+arrows quick adjust 1s; Space play/pause; Enter confirm trim
- Video empty node created via drag-from-image-handle → mode auto "end to end frame" (video_type flf); placeholder checkerboard 16:9 small (300x~80)
- Chips: [Seedance 2.5 ▾] [▣ 720p] [⏰ 5s] [⇄ Advanced Parameters] [1×] [Billing] [Send]
- Resolution chip popover "proportional adjustment" (+reset): "Aspect ratio ⓘ" tiles 16:9 4:3 1:1 3:4 9:16 21:9 adaptive (none selected = null → adaptive to input); "Resolution ⓘ" segmented 480p | 720p | 1080p (options follow model: mini only 480p/720p)
- Duration chip popover "Duration ⓘ": "Smart Duration ⓘ" toggle (tip: "After enabling, the duration will adjust dynamically based on model inference time") + slider + number (Seedance 2.5 4..30 def 5)
- Advanced Parameters (+reset): Seed (-1), First and last frames toggle, Generate sound toggle (on), Watermark toggle (mini: + Fixed camera, Return last frame per schema)
- Billing Seedance 2.5: Input with video 1080p 69 / 720p 28 / 480p 13 credits/s; Input without video 1080p 115 / 720p 46 / 480p 21 credits/s
- Billing Seedance 2.0 mini: with video 720p 12 / 480p 5 credits/s; without video 720p 20 / 480p 9 credits/s; "Discount: Limited-time member discounts apply based on membership tier"
- Switching model to 2.0 mini: tabs shrink to "end to end frame" + "omnipotent reference" (edit/extension hidden); duration chip turns into warning text "Please modify the duration." (null default → validation) until user touches slider; then shows "4s".
- Run: "Cancel build" tooltip (cancellable while queued); node body: spinner + "in line" (=queued, mistranslation) → "Generating"; global pill "Generating 1/1"; done 86.1s (4s 480p mini). Output aspect followed input image (1:1, adaptive).
- Stored: extra.filePath '<uri://ba_resource?...&resource_type=video>', lastFramePath, respJson (provider raw: model id, seed, ratio, duration, fps 24, generate_audio, usage tokens)
- Video result body: plays inline (muted) when selected/hover; overlay time "00:00/00:04" bottom-left; speaker/mute icon top-right
- Video selected toolbar: Trim | Erase | video enhancement | Audio extraction | Audio & Video Separation | Frame Capture | Video Editor | Download | Full screen preview
- Frame Capture: canvas zooms to node, node shows native <video controls> ("Initializing video..." first); bottom panel: [icon] Capture the first frame | Capture the last frame | Real-time frame capture | Clear | Add all to canvas (N) | ×; gallery of captured thumbs with timestamp "00:04.083" and per-item "+" (add one); empty "No data"
- Video fullscreen preview: lightbox with custom controls: ▶ | 00:04/00:04 | scrubber | volume | download | fullscreen; close ×
- Video Trim: canvas zooms; node switches to native controls; bar: × | shortcut-info icon | filmstrip thumbnails timeline with selection window (label "1.00s") | ✓ (same shortcuts as audio trim)
- "video enhancement" inline bar: Cancel | Vod Enhance Video ▾ | template ▾ (General template, UGC short videos, Short dramas, AIGC content, Old film restoration) | resolution ▾ (Original Resolution, 720p, 1080p, 2k, 4k, 8k) | FPS ▾ (Original FPS, 24, 25, 30, 60, 120 fps) | quality ▾ (Fast, Standard, Pro) | Advanced Parameters (Target Bitrate slider 10, Target BitDepth "Original BitDepth", Repair Strength "HD", reset) | Billing | Run
  - Billing table per tier × resolution × fps band, e.g. Fast 720p≤30fps 0.04 c/s … Pro 8K 60–120fps 192 c/s
- Video "Audio extraction" bar: Cancel | Vod Audio Extract ▾ | Billing ("Output Price 0.007 credits/s") | Run
  - Run creates temporary BALLMVideo node "Audio extraction - <source title>" (model Vod Audio Extract, status 1=running) to the right, auto-selected together with source (multi-select toolbar shows: Bypass | Save to Templates | Save to Materials | Video Editor | Group ▾ | Generate)
  - On completion the temp node is REPLACED by 2 BAFileLoad audio nodes: "Extract vocals - 视频生成" and "Extract background sound - 视频生成", stacked vertically, each linked from source by a DASHED virtual edge: edge.data {isVirtual:true, extra:{isSave:true, isDashed:true}} (lineage/provenance, not data dependency)
  - BAFileLoad audio node UI = title + waveform player (no "url" label) + ▶ + 00:00/00:04
- status codes confirmed: -1 empty, 0 configured/manual, 1 running, 2 success
- Derived node naming: "<Tool> - <source title>" (titles keep Chinese default "视频生成" when user never renamed → i18n leak)

## Sticky Notes (MarkdownNote) — "Markdown Note"
- Menu desc: "Logging with Markdown"
- data: {type:'MarkdownNote', title:'Markdown Note', inputs:[{name:'text', type:'STRING', value:'<markdown>'}], outputSlots:[], extra:{uiHeightMap:{text:200}}}; zIndex 10 (renders above other nodes); 300 wide, ~200 body
- Visual: yellow (#F5E6A8-ish) paper card with folded top-right corner; header icon </> + "Markdown Note"; placeholder "Start recording..." centered grey; NO prompt panel, NO model, NO credits icon.
- Selected toolbar: Copy (tooltip "No content to copy" when empty) | Full screen preview; with content: Copy | Download | Full screen preview
- Double-click (tooltip "Double click to edit") → fullscreen editor titled "Markdown Note" with segmented [✎ Edit | 👁 preview] + "Exit Fullscreen"; Edit = monospace textarea; preview = GFM render (h1, bold, italic, lists, task-list checkboxes (rendered but invisible – styling bug), blockquote, inline code, table)
- On canvas shows rendered markdown preview (class ba-markdown-note-preview nowheel → scrolls inside, wheel doesn't zoom canvas); content clipped to card height
- Handles exist but hidden (visibility hidden). Dropping an edge onto sticky body does nothing. BUT Text node output menu offers "Sticky Notes": creates sticky below/right connected with a normal edge (u1Ugt->sticky), sticky content stays EMPTY (no text propagated) → edge is just an annotation link.
- Image output menu does NOT offer Sticky Notes (only text-type outputs can link to sticky).
- Drag from INPUT handle to empty canvas → upstream "Add Node" menu (for Image input: Text, Image, Audio).
- Low zoom (≈41%): video node renders as blank dark card (perf: media not rendered when zoomed out)

## Quick actions ("Try..." list) = mini templates that build sub-graphs
- Text "Write or paste text": switch node to manual editor (title "Write or paste text"), no graph change.
- Text "Elaborate": creates upstream BALLMText node titled "Elaborate" 400px LEFT, connected → current; upstream has preset system_prompt: "You are a professional prompt enricher, and you need to enrich prompts according to the user's prompts. *** Please always follow these rules: *** 1. ... high quality ... 2. ... in line with the user request ..."; current node shows chip "Elaborate ×" and editor "Start your creation...".
- Text "Ask about an image": current node title → "Ask about an image", system_prompt preset "You are a cue word expert who specializes in analyzing user-uploaded images and outputting high-quality cue words. If there is a conflict with the user prompt word, the user prompt word shall prevail."; creates upstream EMPTY Image Generation node (GPT Image 2) 400px left, connected (inputImages). Panel chip "Image Generation ×".
- Image "Image-to-image": creates upstream EMPTY Image Generation node to the left connected as image input; current node placeholder → 1:1 checkerboard; chip "Image Generation ×".
- Image "Upload image": opens OS file picker (not tested).
- New nodes from left "+" menu are placed at viewport center WITHOUT overlap avoidance (overlapped existing nodes in test); default titles stored in Chinese (文本生成/图片生成/视频生成/音频生成) and displayed via i18n until renamed/derived.
