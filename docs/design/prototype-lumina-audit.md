# Đối chiếu prototype node với Lumina

So sánh `web/prototype.html` với ảnh chụp và spec trong [`docs/research/lumina/`](../research/lumina/lumina-nodes-spec.md). Nguyên tắc: **bố cục và tính năng theo Lumina**, giữ **theme sáng** của zcanvas (bạn sẽ quyết theme sau).

Ký hiệu: ✅ đã sửa cho giống Lumina · 🔀 cố ý khác Lumina (cần bạn quyết) · ⏳ chưa làm.

## 1. Khung node (mọi node)

| # | Lumina (ảnh) | Prototype trước | Bây giờ | |
|---|---|---|---|---|
| 1 | Header **nằm ngoài, phía trên card**: icon tím + tên; bên phải badge ⊛ credits và ⏱ thời gian ([13](../research/lumina/img/13-text-selected-with-prompt-panel.jpg), [43](../research/lumina/img/43-image-result-54s.jpg)) | Header nằm trong card | Header ngoài card, badge ⊛ (hover ra giá ước tính) + ⏱ | ✅ |
| 2 | Card rộng **300 px**, chỉ chứa nội dung; ảnh/video tràn hết card | 320/380 px, có padding | 300 px, ảnh/video tràn card | ✅ |
| 3 | Nút **(+)** hai bên card, hiện khi hover/chọn | Không có (dùng "→ Image"…) | Có; menu "Add Node" lọc theo loại nối được | ✅ |
| 4 | Toolbar trên node **chỉ có icon**, theo loại node | Có chữ, có "→ Image/Voice-over" | Chỉ icon: Text ⬇ ⛶ · Image Enhance ⬇ ⛶ · Video Extend ⬇ ⛶ · Audio ⬇ · Sticky Copy ⬇ ⛶ | ✅ |
| 5 | Trống: "Try…" chữ xám + danh sách quick action dạng chữ ([10](../research/lumina/img/10-text-node-selected.jpg)) | Nút có viền | Giống Lumina, đúng danh sách từng node | ✅ |
| 6 | Đã cấu hình: ô caro theo tỉ lệ (Image/Video), icon audio lớn (Audio) | "Ready · press Run" | Ô caro / icon | ✅ |
| 7 | Đang chạy: spinner + "in line"/"Generating", **không %** | Spinner + % + thanh tiến trình | Spinner + "Queued"/"Generating" | ✅ |
| 8 | Pill toàn cục **"Generating n/m"** góc trên phải ([68](../research/lumina/img/68-video-queued-in-line.jpg)) | Không có | Có | ✅ |
| 9 | Toast xong ở trên: "Generated successfully, time-consuming …" | Toast dưới, chữ khác | Toast trên, cùng câu + số credit | ✅ |
| 10 | Tên mặc định "Text/Image/Video/Audio Generation", "Markdown Note"; tool tạo node tên "Enhance - <nguồn>" | "Text", "Image"… | Theo Lumina | ✅ |

## 2. Prompt panel (Composer)

| # | Lumina | Trước | Bây giờ | |
|---|---|---|---|---|
| 11 | Tab mode dạng **nút pill có viền**, mode model không hỗ trợ thì **ẩn**, thiếu input thì **mờ** ([62](../research/lumina/img/62-video-from-image-end-to-end-frame.jpg)) | Thanh segment, luôn hiện | Giống Lumina | ✅ |
| 12 | Nút ⤢ góc trên phải; chip input có **vạch kẻ ngăn** với ô prompt | ⤢ trong ô prompt, không vạch | Giống Lumina | ✅ |
| 13 | Placeholder "Please enter a prompt word, use @ to introduce multimodal output" | Mỗi node một câu | Giống Lumina (Audio: "Input text and convert it into realistic speech.") | ✅ |
| 14 | Footer: model · chip **không viền** (icon + giá trị) · "⇄ Advanced Parameters" … **1×** · cụm **ⓘ Billing + nút chạy tròn** | Chip có viền, hiện "≈ 18", nút Run xanh chữ | Giống Lumina; số credit chỉ hiện khi hover Billing | ✅ |
| 15 | Text: **không có chip Preset**; bấm model mở popover gộp model + tham số + system prompt ([14](../research/lumina/img/14-text-model-params-popover.jpg)) | Chip Preset, nút Advanced riêng | Giống Lumina | ✅ |
| 16 | Image: chip kích thước "2048x2048"/"1k"; popover "proportional adjustment" 9 tỉ lệ + W⟷H + "Image area" 1k/2k ([37](../research/lumina/img/37-image-seedream-size-popover.jpg)); số ảnh (Num) nằm trong Advanced | Chip "1:1 · 2k", "Images 2" ngoài footer | Giống Lumina | ✅ |
| 17 | Video: **một chip "720p"** mở popover tỉ lệ + độ phân giải ([63](../research/lumina/img/63-video-ratio-resolution-popover.jpg)); chip "⏰ 5s" có Smart Duration; Advanced: Seed, Generate sound, Watermark | Ratio và Resolution tách 2 chip | Giống Lumina | ✅ |
| 18 | Audio: 4 mode ta2a / text-to-audio / audio reference / image-to-audio; chip **"♫ Tone Settings"** gồm thẻ Voice tone (⇄ mở thư viện), speed, volume, ngôn ngữ, "More parameters ›" ([75](../research/lumina/img/75-audio-tts-tone-settings-voice.jpg)) | Mode Voice/Music/SFX, chip Voice riêng | Giống Lumina | ✅ |
| 19 | Thư viện giọng "Official tone": lọc giới tính + độ tuổi + tìm kiếm, chip ngữ cảnh, lưới 3 cột ([76](../research/lumina/img/76-audio-tts-voice-library.jpg)) | 2 cột, lọc ngôn ngữ | Giống Lumina | ✅ |
| 20 | Menu `@`: node phía trước + "Color selection ›" | Bảng màu luôn hiện | Giống Lumina | ✅ |
| 21 | Nút chạy khi đang chạy: ■ "Cancel build" | "Stop 45%" | ■ + tooltip Cancel build | ✅ |

## 3. Canvas và từng node

| # | Lumina | Trước | Bây giờ | |
|---|---|---|---|---|
| 22 | Thanh trái: nút **+** mở bảng "Add Node" có mô tả từng loại ([01](../research/lumina/img/01-add-node-menu.jpg)) | 5 nút loại node | Giống Lumina | ✅ |
| 23 | Nhấp đúp vùng trống → menu Add Node tại con trỏ | Không có | Có | ✅ |
| 24 | Shift + click dây = xoá; ⌘Enter = chạy node đang chọn | Không có | Có | ✅ |
| 25 | Quick action là "mini template": Elaborate tạo node Text phía trước; Ask about an image đổi tên + system prompt + tạo node Image phía trước; Image-to-image / Image-to-video tạo node Image phía trước; Combine images tạo 2 node Image | Chỉ điền sẵn prompt | Giống Lumina | ✅ |
| 26 | Tool (Enhance…) tạo node mới nối từ nguồn, đặt chỗ trống, canvas cuộn tới | Có nhưng không cuộn | Giống Lumina | ✅ |
| 27 | Text fullscreen: trang riêng, sửa được, Copy + Exit Fullscreen ([22](../research/lumina/img/22-text-fullscreen-editor.jpg)) | Lightbox chỉ xem | Giống Lumina | ✅ |
| 28 | Video xong: tự phát không tiếng, thời gian góc dưới trái, nút tắt tiếng góc trên phải ([6C](../research/lumina/img/6C-video-inline-playback-closeup.jpg)) | Thanh điều khiển dưới | Giống Lumina | ✅ |
| 29 | Audio xong: waveform + playhead, thanh tua, loa · ▶ · thời gian ([77](../research/lumina/img/77-audio-result-waveform-player.jpg)) | Một hàng nhỏ | Giống Lumina | ✅ |
| 30 | Sticky "Markdown Note": vàng, **góc gấp**, "Start recording…", luôn nằm trên; nhấp đúp mở **trang toàn màn hình** Edit/Preview + Exit Fullscreen ([80](../research/lumina/img/80-sticky-markdown-note-selected.jpg), [82](../research/lumina/img/82-sticky-fullscreen-edit-markdown.jpg)) | 6 màu, modal nhỏ | Giống Lumina | ✅ |
| 31 | Menu "+" của Text có "Sticky Notes" (dây chỉ để chú thích, không truyền dữ liệu) | Không cho nối sticky | Có, dây nét đứt | ✅ |
| 32 | Minimap mặc định tắt | Luôn hiện, đè Composer | Bỏ | ✅ |

## 4. Chỗ cố ý khác Lumina — cần bạn quyết

| # | Khác gì | Lý do | Gợi ý |
|---|---|---|---|
| A | **Theme sáng** | Bạn chọn giữ trước | Quyết sau |
| B | **Lịch sử chạy trên node** (‹ 2/3 › dưới card, chỉ hiện khi đã chạy ≥ 2 lần) | Lumina ghi đè kết quả, chỉ giữ ở "Creative history" toàn cục ([spec §10 #2](../research/lumina/lumina-nodes-spec.md)) | Giữ hoặc bỏ |
| C | Text có công tắc **"Use this node's text as context"** (mặc định bật) | Lumina bỏ qua chữ đang có trong node rồi ghi đè ([§10 #1](../research/lumina/lumina-nodes-spec.md)) | Giữ (feedback #7) |
| K | **Text: popover model chỉ còn dropdown model + Effort (thanh trượt) + System prompt.** Bỏ Thinking mode, Max length, Temperature, Top P, Seed (Lumina [14](../research/lumina/img/14-text-model-params-popover.jpg), [16](../research/lumina/img/16-text-model-params-gpt55.jpg) đưa hết lên UI). Effort Low/Medium/High (tuỳ model) thay cho thinking/reasoning của từng nhà cung cấp. Bố cục popover giữ như Lumina | Người dùng cần chọn đúng model và ra kết quả, không cần thông số API | Đã chốt (feedback #5–6). Image/Video/Audio: chưa đổi |
| D | Node mới **không đè lên node cũ** (Lumina đặt giữa màn hình, chồng lên nhau) | Lỗi của Lumina ([§10 #3](../research/lumina/lumina-nodes-spec.md)) | Giữ |
| E | Bảng Add Node **tự đóng** sau khi thêm (Lumina phải bấm × mới đóng) | Lỗi của Lumina ([§10 #10](../research/lumina/lumina-nodes-spec.md)) | Giữ |
| F | **Image cũng huỷ được** khi đang chạy (Lumina: "Generating, cannot cancel") | Lỗi của Lumina ([§10 #7](../research/lumina/lumina-nodes-spec.md)) | Giữ |
| G | Đổi model mà input không hợp → **toast có Undo** (Lumina chỉ có tooltip) | Cho phép hoàn tác | Giữ |
| H | Tên mode/tab dịch lại cho đúng ("First & last frame", "Text to audio"…) thay vì "end to end frame", "Vincent Audio" | Lumina dịch sai ([§10 #4](../research/lumina/lumina-nodes-spec.md)) | Giữ |
| I | Thư viện giọng có thêm 2 giọng tiếng Việt (Linh, Minh) | Dữ liệu demo | Tuỳ |
| J | Ảnh/video/audio là dữ liệu giả; Upload chọn file mẫu thay vì mở hộp thoại hệ thống | Prototype không có backend | — |

## 5. Chưa làm (có trong Lumina, ngoài phạm vi vòng này)

| Mục | Ghi chú |
|---|---|
| Tool khác trên toolbar: Crop, Draw, Multi-Angle, Split, Lighting, 720°, Trim, Frame Capture, Audio extraction, Video Editor… | Mỗi tool là một luồng riêng; nên làm sau khi chốt khung |
| Thanh Enhance inline (mode, 2k/4k/8k, Detail Intensity, Billing) trước khi tạo node | Hiện bấm Enhance là tạo node luôn |
| Camera Control (Image), Panorama | Popover lớn riêng |
| Bảng màu đầy đủ (SV pad, hue, hex) cho `@` → Color selection | Hiện là 12 màu có sẵn |
| Chuột phải trên node (Add to dialog box, Run subsequent nodes…) | |
| Creative history, Group, Smart Layout, thanh dưới (snap, ẩn dây…) | Thuộc canvas, không thuộc node |
| Resize node | Lumina cho resize khi chọn (tối thiểu 300×100) |

## 6. Image, Video, Audio: cấu hình và hành vi theo Lumina (feedback #9–#10)

Nguồn: `_raw-notes.md` + ảnh 30–56 (Image), 60–6G (Video), 70–79 (Audio).

### Image
| Mục | Theo Lumina | Ảnh |
|---|---|---|
| Model | 11 model: GPT Image 2, Seedream 5.0 Pro / 5.0 Lite / 4.5, Nano Banana Pro / 2 (Beta), Seedream 4.0, SeedEdit 3.0 (mờ khi chưa có ảnh input), Seedream 3.0L (Art Edition), 3.0L, Layer Decomposition. Danh sách dạng dòng có icon nhà cung cấp | 31 |
| Mặc định | Tạo từ Text → GPT Image 2; tạo trên canvas trống → Seedream 5.0 Pro | 30 |
| Chip theo model | GPT Image 2: Panorama · kích thước có sẵn (7 cỡ, mặc định 2048x1152) · Camera · Advanced (Num, quality). Seedream: kích thước tỉ lệ/W×H/Image area · Advanced (format, watermark, seed, group image…). Nano Banana: tỉ lệ + 1K/2K/4K · Camera | 31–38 |
| Camera Control | 4 cột Camera / Lens / Focal / Aperture, bật/tắt, Save; chip "Camera off" ↔ tên máy, hover hiện lens/focal/aperture | 33–34 |
| Billing | Bảng giá theo model (vd. Seedream 5.0 Pro: Input 0–0.3, Output 9–18 credits/image) | 36 |
| Chạy | Không huỷ được: nút ■ khoá, tooltip "Generating, cannot cancel" | 42 |
| Thanh công cụ | Crop · Enhance · Draw · Multi-Angle · Layer Decomposition · 720° ▾ · Storyboard ▾ · Lighting ▾ · Split ▾ · ⋯ ▾ │ Video Editor · Download · Full screen | 44 |
| Crop | Zoom vào node, khung 8 tay nắm + lưới 1/3, thanh cancel / tỉ lệ ▾ / confirm; ảnh cắt thay ảnh hiện tại | 49 |
| Enhance | Thanh Cancel / Creative Upscale ▾ / 2k-4k-8k / Detail 0–100 / Billing / Run → node mới "Enhance", tự chạy, canvas cuộn tới | 50–53 |
| Split | 2×2 · 3×3 · 4×4 · 5×5 · Custom → "crop only" tạo N node "Grid slice i" bên phải, không nối dây, chọn cả nhóm | 45–47 |
| Xem toàn màn hình | Zoom −/thanh trượt/+, 1:1, xoay ±90°, tải về | 48 |
| Quick action | Upload image; Image-to-image tạo node Image trống phía trước | 3A |

### Video
| Mục | Theo Lumina | Ảnh |
|---|---|---|
| Model | 9 model Seedance; danh sách **chỉ hiện model hỗ trợ mode đang chọn** (Omni reference: 2.5 / 2.0 / 2.0 fast / 2.0 mini), dạng thẻ có dòng "Supports multimodal video generation" | 61 |
| Tab mode | Đổi sang 2.0 mini → chỉ còn First & last frame + Omni reference | 66 |
| Thời lượng | 2.0 mini không có mặc định → chip đỏ "Please modify the duration.", khoá Run; 2.5 có Smart Duration | 64, 66 |
| Advanced | Seed · First and last frames · Generate sound · Watermark (+ Fixed camera, Return last frame tuỳ model) | 65 |
| Billing | Bảng theo độ phân giải, giá khác khi có video input; 2.0 mini có dòng Discount | 67 |
| Chạy | Huỷ được khi còn Queued; đang Generating thì không | 68 |
| Thanh công cụ | Trim · Erase · video enhancement · Audio extraction · Audio & Video Separation · Frame Capture │ Video Editor · Download · Full screen | 69 |
| Trim | Zoom vào node, thanh dưới: × · phím tắt · filmstrip có khung chọn "1.00s" · ✓; phím ←/→ ↑/↓ I/O Shift ⌘ Enter Esc | 6D |
| video enhancement | Thanh Cancel / Vod Enhance Video / template / resolution / FPS / quality / Advanced (Bitrate, BitDepth, Repair Strength) / Billing / Run → node mới | 6E–6F |
| Audio extraction | Cancel / Vod Audio Extract / Billing 0.007 credits/s / Run → node tạm "Audio extraction - <nguồn>" → thay bằng 2 node audio "Extract vocals" + "Extract background sound", **dây nét đứt** (không truyền dữ liệu) | 6G |
| Frame Capture | Bảng dưới node: first / last / real-time frame, Clear, Add all to canvas (N), "+" từng ảnh, "No data" khi trống → node ảnh "Frame 00:02.000" | 6A |
| Xem toàn màn hình | ▶ · thời gian · thanh tua · âm lượng · tải về | 6B |
| Quick action | Upload video · Image-to-video · Combine images into a video · Video-to-video | 60 |

### Audio
| Mục | Theo Lumina | Ảnh |
|---|---|---|
| Seed TTS | chỉ "Text to audio"; Tone Settings: Voice tone (⇄ thư viện), speed_rate, Volume, explicit language, More parameters › (Vibe Prompt, Pitch, Emotion scale, Model seed-tts-1.1, Format pcm/ogg_opus/mp3, Sample rate, Bit rate). Billing "TTS Price 0.004 credit/characters" | 75 |
| Seed Audio | 4 mode; Tone Settings: Speed rate, Volume, Pitch, Model seed-audio-1.0, Format (wav), Audio sampling rate (48000). Billing 0.25 credits/s | 73 |
| Thư viện giọng | "Official tone": All gender / All ages / tìm kiếm, 22 nhóm ngữ cảnh của Lumina, 10 giọng Lumina (+ Linh, Minh) | 76 |
| Thanh công cụ | Trim · Video Editor · Download; Trim như video nhưng là waveform, nhãn "00:01" | 78–79 |
| Chạy | Huỷ được ("Cancel build") | — |

### Phần giả định (Lumina có nút nhưng nghiên cứu chưa mở) — cần xác nhận
| Nút | Prototype đang làm |
|---|---|
| Image: Draw, Panoramic view, "Create a storyboard grid", Video Editor | Báo "chưa có trong prototype" |
| Image: Multi-Angle, Layer Decomposition, 720° panorama generation, Storyboard ▾, Lighting ▾, ⋯ ▾ (Character, Repaint, Erase, Expansion, Matting, Label, Camera Control) | Theo mẫu Lumina đã thấy ở Enhance: tạo node mới đặt tên theo tool, tự chạy |
| Video: Erase | Như trên (node mới "Erase") |
| Video: Audio & Video Separation | Báo "chưa có trong prototype" |
| Gắn giọng vào nhóm ngữ cảnh | Tự gán (Lumina không lộ cách gán) |
| Chọn nhiều node | Lumina có thanh nhóm (Typesetting, Download, Bypass, Save to Templates…); prototype chỉ ẩn thanh công cụ riêng |

## 7. Hai dạng node Image / Video / Audio (feedback #11)

| | Node Gen (tạo bằng AI) | Node media thường |
|---|---|---|
| Từ đâu ra | Thêm node, menu "+", quick action Elaborate / Image-to-image… | Upload, Grid slice, Frame Capture, Extract vocals / background sound |
| Bấm vào | Hiện prompt panel (model, chip, Billing, nút chạy) + thanh công cụ | **Chỉ thanh công cụ chỉnh sửa** (Crop, Enhance, Split, Trim, Frame Capture…) |
| Header | Icon loại node, badge ⊛ credit, ⏱ | Icon file, không có badge credit |
| Cổng nối | Vào và ra | **Chỉ ra** (không nhận input; nối vào sẽ báo lỗi) |
| Khi trống | "Try…" quick actions | Luôn có nội dung |

Quick action "Upload image / video / audio" biến node thành media thường.

## 8. Để sau (ngoài phạm vi 5 node)

Trang Gen · thanh công cụ khi chọn nhiều node (Typesetting, Bypass, Save to Templates, Group…) · Video Editor · Creative history · menu chuột phải (Add to dialog box, Run subsequent nodes…) · Group / Smart Layout · thanh dưới canvas (minimap, snap, ẩn dây) · node Script Planning / Director's Desk / Interactive Film.
