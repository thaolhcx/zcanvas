# BytePlus Lumina — ba "space" Image · Video · Audio (feed + composer)

Phần 4 của nghiên cứu Lumina, xem lại kỹ ba trang gen riêng với tài khoản đã đăng nhập, có lịch sử thật. Bổ sung cho [phần 2](../lumina-apps/lumina-apps-image-video-spec.md) (đã có schema, Director mode, AI Apps) và [phần 3](../lumina-agent/lumina-agent-chat-spec.md) (Agent, Canvas Agent).

| | |
|---|---|
| Xem ngày | 2026-10-04, `/model/image`, `/model/video`, `/model/audio` |
| Cách làm | Dùng UI, không bấm Generate (0 credit). Re-edit một thẻ cũ để xem composer được điền lại. |
| Ảnh | 20 ảnh trong [`img/`](img/): `I*` Image, `V*` Video, `A*` Audio |

---

## 1. Cùng một khung cho cả ba

```
┌ sidebar ┐ ┌──────────────── feed (cuộn, mới nhất dưới cùng) ────────────────┐ ┌ dock ┐
│ Image   │ │ 2026-10-02 10:46:24                                              │ │Explore│
│ Video   │ │ [Image001] as a cute 3D clay figurine…  ⎔ Seedream 5.0 Pro       │ │History│
│ Agent   │ │ Reference images · Proportion 1:1 · Adv Params ⓘ                 │ │ ░░░░ │
│ Audio   │ │ ┌────────┐                                                       │ │ ░░░░ │
│         │ │ │ result │ ⋯                                                     │ │ ░░░░ │
│         │ │ └────────┘                                                       │ │      │
│         │ │ [✎ Re-edit] [↻ Regenerate] [🗑]                                  │ │      │
│         │ └──────────────────────────────────────────────────────────────────┘ │      │
│         │ ┌──────────────────────── composer dính đáy ───────────────────────┐ │      │
│         │ │ [slot] Describe the scene…  (@ để tham chiếu)                 [⤢] │ │      │
│         │ │ [AI Image ▾] [model ▾] [chip theo model…] [⚙]   Pricing ⓘ [Gen ✦] │ │      │
│         │ └──────────────────────────────────────────────────────────────────┘ └──────┘
```

| Phần | Image | Video | Audio |
|---|---|---|---|
| Chip đầu tiên (đổi space) | `AI Image ▾` → AI Image / AI Video / Audio ([A02](img/A02-audio-media-switch.jpg)) | như Image | như Image |
| Slot bên trái ô nhập | `image`: local upload / material library | `material`: local upload / material library / **Portrait Gallery** / **3D Director's Desk** ([V03](img/V03-video-material-menu-portrait-directors-desk.jpg)) | Seed Audio: `material` (audio tham chiếu, gọi bằng `@Audio1`) ([A05](img/A05-audio-material-menu.jpg)) · Seed Speech: `Voice` → thư viện giọng ([A08](img/A08-audio-seed-speech-voice-library.jpg)) |
| Ô nhập | 1 ô prompt, `@` gọi `Image001`/`Region01`, chip inline ([I05](img/I05-image-reedit-fills-composer.jpg)) | 1 ô prompt; **Director mode** đổi thành timeline ([V05](img/V05-video-director-mode-timeline.jpg)) | Seed Audio: 1 ô (style + text, ví dụ in sẵn 2 dòng) · Seed Speech: **2 ô** — *Vibe Prompt* (optional, "extremely happy") và *Text* ([A07](img/A07-audio-seed-speech-composer-voice-vibe-text.jpg)) |
| Chip theo model | `Seedream 5.0 Pro ▾` · `Universal Reference ▾` (function) · `1:1` · `⇄` (adv) | `Seedance 2.5` · `Adaptive` · `480p` · `4s` · `⚙` (Adv Params: Seed, Generate video with audio — [V04](img/V04-video-adv-params.jpg)) · `Creation mode | ✦Director mode` | `Seed Audio 1.0 (Beta)` / `Seed Speech 2.0` ([A03](img/A03-audio-model-picker.jpg)) · `Setting` (Pitch, Volume, Reset — [A04](img/A04-audio-setting-pitch-volume.jpg)) · Seed Speech thêm `Auto ▾` (ngôn ngữ, chỉ có Auto — [A09](img/A09-audio-seed-speech-language-auto.jpg)) và **`Auto prompt`** (*"Automatically create matched vibe prompts"* — [A10](img/A10-audio-auto-prompt-tooltip.jpg)) |
| Nút chạy | `Generate ✦9` | `✦84` | `Generate ✦0.25 / s` (tính theo giây) |
| Feed card | Timestamp · prompt có chip · model · chip tham số · ảnh · Re-edit / Regenerate / 🗑 · hover ⋯ ([I02](img/I02-image-feed-cards-and-history-dock.jpg), [I04](img/I04-image-feed-result-hover-more.jpg)) | như Image, thêm `Resolution 1080p · Duration 4s`; thẻ bị huỷ ghi **`cancelled · TaskID: …`** ([V02](img/V02-video-feed-cards.jpg)) | chưa có lịch sử audio để xem; cấu trúc giống |
| Dock phải | Explore \| History: tìm "Prompt keywords", Time ▾, Generation type ▾, lưới masonry ([A06](img/A06-audio-history-dock.jpg)) | như Image | như Image |
| Chi tiết | Click ảnh → modal: zoom, Image/Video only mode, Comparison mode, ⋯, tải, ☆; bên phải: tác giả, model, prompt có chip, chip tham số, bảng tham số thật (min_ratio, max_ratio, cot_mode, use_pre_llm, **Seed thật**), ngày, **✦ Clone & try**; dải filmstrip để lật ([I03](img/I03-image-artwork-detail-modal.jpg)) | như Image | — |

**Re-edit** điền lại composer đúng y: slot có thumbnail (kèm badge annotation), ô nhập có chip `Region01` + prompt, model/function/ratio như cũ; toast *"Successfully filled in parameters"* ([I05](img/I05-image-reedit-fills-composer.jpg)).

**Trống**: Audio chưa có lịch sử nên feed chỉ có dòng "Light Up Your Creation With Lumina" ở giữa ([A01](img/A01-audio-page-empty.jpg)).

---

## 2. Điều ba space cho thấy về cách tiếp cận của họ

1. **Space = feed + composer, không có agent.** Mỗi tin là một lần gen, một model. Không hỏi lại, không nhiều bước. "Chat" ở đây chỉ là *lịch sử theo dòng thời gian*.
2. **Composer đổi theo model, không theo space.** Cùng trang Audio nhưng Seed Audio có 1 ô + material, Seed Speech có 2 ô + Voice + Auto prompt. Space chỉ quyết định *kind* đầu ra.
3. **Ba cách lặp trên một kết quả:** Re-edit (đổ lại composer), Regenerate (chạy lại y nguyên), Clone & try (từ modal, kể cả của người khác). Composer **giữ** prompt sau khi gửi.
4. **Tham chiếu là chip có tên** (`Image001`, `Region01`, `@Audio1`) và nằm **trong** prompt. Slot bên trái chỉ là nơi nạp; prompt mới là nơi nói "dùng cái này làm gì".
5. **Giá hiện ở nút** (✦9, ✦84, 0.25/s) và trong thẻ — tool nội bộ của mình **không** làm vậy.
6. **Audio tách "giọng" khỏi "nội dung":** Vibe Prompt (cách nói) và Text (nói gì); Auto prompt sinh vibe từ text. Tốt hơn một ô gộp.
7. **Lịch sử = tài sản.** History dock là masonry theo thời gian/loại, chung với Assets; Clone & try đưa bất kỳ mục nào trở lại composer.

**Chưa ổn:** feed không có nhánh (sửa ảnh 2 lần là 2 thẻ rời, không thấy quan hệ); không gửi được kết quả từ space sang canvas trực tiếp; thẻ lỗi chỉ ghi `cancelled · TaskID`.

---

## 3. Đặt cạnh Agent và Canvas Agent (phần 3)

| | Space (Image/Video/Audio) | Canvas Agent | Agent |
|---|---|---|---|
| Hợp với | Gen nhanh, lặp nhanh, một model | Dựng/sửa flow bằng lời, trên canvas | Video dài có kịch bản |
| Một tin = | một lần gen | một yêu cầu → node | một lượt hội thoại |
| Kết quả ở | feed | canvas (node) | panel tài liệu → storyboard |
| Tham chiếu | `@Image001` trong prompt | `@node`, `/skill`, + từ canvas | đính kèm + `@Haru` trong storyboard |
| Model | chọn tay, đầu hàng | Auto, panel riêng | ẩn |

Ba bề mặt, ba lịch sử rời nhau — đây là cái giá của việc tách.

---

## 4. Gợi ý cho zcanvas: một "space" là một canvas ẩn, nhìn như feed

Giữ nguyên kết luận ở phần 3 (chat space = Canvas Agent của mình), và bổ sung từ ba space:

| Lấy | Gì |
|---|---|
| Feed card | Thẻ = một lần chạy node: prompt có chip vai trò, model (nhỏ, "Auto · …"), chip tham số, kết quả, **Re-edit / Regenerate**. Đây chính là `RunEntry` của mình, render dạng feed. |
| Composer | **Dùng y Composer của node** (`layout="wide"`), chip đầu hàng = loại kết quả (Text / Image / Video / Audio) thay cho "AI Image ▾". Không viết composer thứ hai. |
| Audio | Tách Vibe / Text cho TTS; "Auto prompt" sinh vibe. Đưa vào spec Audio node (mode t2a) chứ không chỉ space. |
| Lịch sử | Dock History tìm theo prompt/thời gian/loại, dùng chung Media browser đã có. |
| Clone & try | Mở bất kỳ asset nào trong Media browser → "Dùng lại cấu hình". |
| Của mình | Mỗi thẻ là node của một **canvas ẩn**; "Mở trong canvas" trải feed thành node + dây để rẽ nhánh — chữa đúng điểm yếu "feed không có nhánh" của Lumina. Không hiện giá. |

Nói gọn: **space của mình = feed trên canvas ẩn + Composer của node**; chat với agent là lớp đặt lên trên cùng dữ liệu đó (phần 3). Không phải ba sản phẩm.
