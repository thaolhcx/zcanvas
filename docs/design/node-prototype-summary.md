# Prototype 5 node: tóm tắt

Trạng thái ngày 2026-10-04, branch `feat/node-prototype`. Đây là bản để đọc duyệt.
- Chi tiết đối chiếu với Lumina: [prototype-lumina-audit.md](prototype-lumina-audit.md)
- Các góp ý đã xử lý: [prototype-feedback.md](prototype-feedback.md)

## 1. Mở và dùng

- Mở `http://127.0.0.1:5173/prototype.html`. Đây là trang riêng, không đụng tới canvas chính.
- Dữ liệu đều là giả, không gọi backend:
  - Ảnh là hình SVG sinh ngẫu nhiên.
  - Video là ảnh poster có chuyển động.
  - Audio là âm thanh tổng hợp.
- Nút **Reset** đưa canvas về luồng demo: Note → Text → Image (kèm Logo.png) → Video, và Text → Audio.

## 2. Nguyên tắc đã chốt

1. **Phạm vi chỉ gồm 5 node:** Text, Image, Video, Audio, Sticky. Phần ngoài phạm vi để sau (mục 8).
2. **Bố cục và hành vi theo Lumina, giữ theme sáng.** Theme sẽ quyết sau.
3. **Cấu hình model là dữ liệu,** vì nó thay đổi hằng ngày. Giao diện chỉ dựng từ vài loại điều khiển chung, nên đổi model chỉ cần sửa dữ liệu.
4. **Image / Video / Audio có hai dạng:**
   - **Node Gen:** bấm vào thì hiện ô nhập prompt.
   - **Node media thường:** bấm vào chỉ có công cụ chỉnh sửa.
5. **Chỗ cố ý khác Lumina:** chỉ khi Lumina có lỗi hoặc khi bạn đã đồng ý. Danh sách ở mục 7.

## 3. Khung chung của mọi node

| Phần | Mô tả |
|---|---|
| Header (nằm ngoài khung) | Icon và tên node (nhấp đúp để đổi tên). Bên phải có badge ⏱ thời gian chạy. **Không có credit/billing ở đâu cả:** đây là tool nội bộ; hạn ngạch (nếu có) tính sau. |
| Khung | Rộng 300px, chỉ chứa nội dung. Ảnh và video tràn hết khung. |
| Nút "+" hai bên | Hiện khi rê chuột hoặc khi chọn node. Bên trái thêm node đầu vào, bên phải thêm node đầu ra. Menu chỉ liệt kê loại node nối được. Node mới đặt vào chỗ trống, tự nối dây và canvas cuộn tới. |
| Trạng thái | **Trống:** "Try…" với các quick action, chỉ bấm được khi đã chọn node. **Đã cấu hình:** ô caro theo tỉ lệ (Image/Video) hoặc icon (Audio). **Đang chạy:** spinner + Queued/Generating. **Xong:** hiện kết quả. |
| Thanh công cụ (phía trên) | Hiện khi chọn một node đã có kết quả. Chỉ gồm icon, tuỳ loại node. Chọn nhiều node thì ẩn. |
| Lịch sử chạy | Dải ‹ 2/3 › dưới khung, chỉ hiện khi đã có từ 2 kết quả trở lên. Đây là phần zcanvas thêm; Lumina không có. |
| Khi chạy xong | Toast "Generated successfully…" ở trên cùng, kèm pill "Generating n/m" ở góc phải. |

## 4. Prompt panel (dưới node Gen khi được chọn)

Thứ tự từ trên xuống:
1. Tab mode (Video, Audio): mode model không hỗ trợ thì ẩn, mode thiếu input thì mờ.
2. Chip input đang nối, mỗi chip ghi **vai trò** của input đó: *Prompt · Idea → prompt*, *First frame · Key visual 1*, *Source · Clip.mp4*. Vai trò tuỳ loại node và mode (Video: First frame / Last frame ở mode khung đầu-cuối, Source ở mode sửa/nối dài, Reference ở mode tham chiếu; Image: Prompt / Reference / Source (nhiều ảnh được, giới hạn theo model); Audio: Script / Voice reference; Text: tất cả là Context). Hệ thống tự xếp khi nối dây và xếp lại khi đổi mode; bấm vào vai trò để đổi (chọn slot đã có người thì hai bên hoán đổi). Input không có chỗ trong mode hiện tại thì chip đỏ "No slot" và khoá Run. Bấm × là xoá dây.
3. Ô prompt: gõ `@` là **autocomplete** như trong code editor: gõ tiếp để lọc các node đang nối, ↑↓ chọn, Enter/Tab chèn, Esc đóng; mục "Color selection" nằm cùng danh sách. Token đã chèn hiện thành chip dưới ô. Nút ⤢ mở to.
4. Hàng dưới: chip model **"Auto · <tên model>"** (Auto = hệ thống chọn; chọn tay thì ghim) → các chip kết quả (kích thước, thời lượng, số lượng…) → "Advanced Parameters" hoặc "Tone Settings" → "1×" (chạy nhiều lần) → nút chạy. Không có billing. (Thứ tự chip model đứng đầu chốt ở feedback #30.)

Phím tắt: ⌘Enter chạy node đang chọn.

## 5. Từng node

### Text
- **Chip** ghi tên preset đang dùng (vd "Enrich prompt"). **Popover:** *What to write* (Custom · Ad copy · Enrich prompt · Describe media · Script / storyboard) → **System prompt** (preset điền sẵn, sửa được) → công tắc "Use this node's text as context" → mục **Model** (Auto · … hoặc chọn tay) → **Effort** (thanh trượt Low…High). Đã bỏ temperature, max length, seed.
- **Quick action:**
  - Write or paste text.
  - Elaborate: tạo node Text "Elaborate" phía trước.
  - Ask about an image: tạo node Image phía trước và đặt sẵn system prompt.
- **Nội dung:** nhấp đúp để sửa tay. Thanh công cụ có Download và Fullscreen; Fullscreen mở trang soạn thảo riêng, có Copy.
- **Huỷ khi đang chạy:** được.

### Image
- **11 model của Lumina.** SeedEdit và Layer Decomposition bị mờ khi chưa có ảnh input. Node tạo từ Text mặc định dùng GPT Image 2.
- **Chip theo từng model:**
  - GPT Image 2: Panorama, 7 kích thước có sẵn, Camera Control, và Num/quality trong Advanced.
  - Seedream: kích thước (tỉ lệ, W×H hoặc Image area 1k/2k).
  - Nano Banana: tỉ lệ + 1K/2K/4K, và Camera.
- **Không huỷ được** khi đang chạy ("Generating, cannot cancel").
- **Thanh công cụ:**
  - **Crop:** cắt tại chỗ.
  - **Enhance:** thanh tuỳ chọn → tạo node "Enhance" và tự chạy.
  - **Split:** chia 2×2…5×5 thành các node "Grid slice".
  - Draw, Multi-Angle, Layer Decomposition, 720°, Storyboard, Lighting, ⋯.
  - Video Editor, Download, Fullscreen (zoom, 1:1, xoay, tải về).
- **Quick action:** Upload image, Image-to-image (tạo node Image phía trước).

### Video
- **9 model Seedance.** Danh sách chỉ hiện model hỗ trợ mode đang chọn.
- **4 mode:** First & last frame, Omni reference, Video editing, Video extension. Mode tự đổi theo input được nối.
- **Chip:** độ phân giải (gộp chung với tỉ lệ) và thời lượng (có Smart Duration).
  - Riêng 2.0 mini không có thời lượng mặc định: chip báo đỏ "Please modify the duration." và khoá nút chạy cho tới khi chọn.
- **Huỷ:** chỉ được khi còn Queued.
- **Thanh công cụ:**
  - **Trim:** filmstrip có phím tắt.
  - **video enhancement:** thanh tuỳ chọn → node mới.
  - **Audio extraction:** chạy một node tạm, rồi tạo 2 node "Extract vocals" và "Extract background sound", nối bằng dây nét đứt.
  - **Frame Capture:** chụp frame đầu, cuối hoặc frame đang phát, rồi thêm thành node ảnh.
  - Erase, Audio & Video Separation, Video Editor, Download, Fullscreen.
- **Quick action:** Upload video, Image-to-video, Combine images into a video, Video-to-video.

### Audio
- **2 model:**
  - Seed TTS: chỉ "Text to audio".
  - Seed Audio: 4 mode.
  - Nếu input không hợp với model đang chọn, model tự đổi và hiện toast có Undo.
- **Tone Settings:**
  - Thẻ Voice tone, bấm ⇄ mở thư viện giọng "Official tone" (lọc theo giới tính, độ tuổi, ngữ cảnh, tìm kiếm, ▶ nghe thử).
  - speed, volume, ngôn ngữ, và "More parameters ›".
- **Kết quả:** waveform có playhead, thanh tua, nút loa / ▶ / thời gian.
- **Thanh công cụ:** Trim (trên waveform), Video Editor, Download.
- **Quick action:** Upload audio.

### Sticky (Markdown Note)
- Màu vàng, góc gấp. Không có AI, không chạy.
- Nhấp đúp mở trang toàn màn hình, có Edit / Preview (Markdown, checkbox bấm được).
- Thanh công cụ: Copy, Download, Fullscreen.
- Từ menu "+" của Text có thể gắn Sticky vào bằng dây nét đứt. Dây này chỉ để chú thích, không truyền dữ liệu.

## 6. Node media thường

Gồm: file tải lên, Grid slice, Frame, Extract vocals / background sound.

- **Khi bấm vào:** chỉ có thanh công cụ chỉnh sửa. Không có prompt, icon là dạng file.
- **Cổng nối:** chỉ có cổng ra. Kéo dây vào sẽ bị từ chối.
- **Cách tạo từ node Gen:** "Upload" mở bảng chọn file; chọn xong thì node mới thành media.

## 7. Chỗ cố ý khác Lumina (cần bạn xác nhận)

| Khác gì | Vì sao |
|---|---|
| Theme sáng | Bạn chọn, quyết sau |
| **Không có credit / billing** (badge, pill, bảng giá, toast) | Tool nội bộ; sau này nếu cần sẽ đưa credit ra làm hạn ngạch |
| **Vai trò trên chip đầu vào** (First frame, Source, Reference…) | Lumina chỉ xếp thứ tự tham chiếu và dựa vào `@` trong prompt; mình nói rõ input nào đóng vai gì, và đây chính là port trong recipe |
| Lịch sử chạy trên node | Lumina ghi đè kết quả |
| "Use this node's text as context" | Lumina bỏ qua chữ đang có trong node |
| Model mặc định "Auto", đứng cuối hàng; Text dẫn bằng preset ý định, model/effort ở dưới | User làm việc với flow, không với model ([node-flow-interaction.md](node-flow-interaction.md)) |
| Node mới không đè lên node cũ; bảng Add Node tự đóng | Đây là lỗi của Lumina |
| Đổi model do input không hợp → toast có Undo | Cho phép hoàn tác |
| Dịch lại tên mode ("First & last frame", "Text to audio") | Lumina dịch sai ("end to end frame", "Vincent Audio") |
| Thêm 2 giọng tiếng Việt (Linh, Minh) | Dữ liệu demo |

**Phần tôi phải đoán, vì Lumina có nút nhưng lúc nghiên cứu chưa mở bên trong:**
- **Làm theo mẫu của Enhance** (tạo node mới mang tên tool rồi tự chạy): Multi-Angle, Layer Decomposition, 720°, Storyboard, Lighting, ⋯, Erase.
- **Chỉ báo "chưa có":** Draw, Panoramic view, Storyboard grid, Audio & Video Separation, Video Editor.
- **Cách gán giọng vào nhóm ngữ cảnh:** tôi tự gán.

## 8. Để sau (ngoài 5 node)

- Trang Gen.
- Thanh công cụ khi chọn nhiều node.
- Video Editor.
- Creative history.
- Menu chuột phải.
- Group / Smart Layout.
- Thanh dưới canvas.
- Các node Script Planning / Director's Desk.

## 9. Code

| Thư mục / file | Vai trò |
|---|---|
| `web/src/kit/` | Bộ UI dùng lại được (không phụ thuộc canvas): Composer, các field, Camera Control, kết quả/player, popover, markdown, logic kiểm tra (ước tính chi phí vẫn có trong data, không hiện) |
| `web/src/prototype/catalog.ts` | Dữ liệu node và model (tham số, mode, cấu hình `@`) |
| `web/src/prototype/nodes.tsx` | Khung node, Sticky, bảng chọn file |
| `web/src/prototype/imageTools.tsx`, `mediaTools.tsx` | Thanh công cụ của Image / Video / Audio |
| `web/src/prototype/store.ts`, `actions.ts`, `generate.ts` | Trạng thái giả, các thao tác (crop, split, trim, extract…), sinh kết quả giả |
| `web/vite.prototype.config.ts`, `web/prototype.html` | Chạy prototype riêng |

Chưa commit.
