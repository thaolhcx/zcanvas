# Flow tương tác của node: user làm việc với flow, không với model

Ngày 2026-10-04. Prototype (`web/prototype.html`) là bản thiết kế; thứ cần chốt là **cách user tương tác với flow**. Doc này soi từng điểm tương tác của prototype theo một câu hỏi duy nhất: *user đang nói ý định với flow, hay đang vặn nút của model?*

Review kiến trúc code ([node-architecture-review.md](node-architecture-review.md)) để lại dùng sau, khi flow đã chốt.

## 1. Nguyên tắc

1. **User nói ý định, flow mang ý định đi.** Ý định nằm ở chỗ *nối gì vào đâu* và *muốn ra gì*: "ảnh này thành video", "viết lại đoạn này", "lồng tiếng cho clip". Node và dây là cách thể hiện ý định đó.
2. **Model là hệ quả, không phải lựa chọn đầu tiên.** Hệ thống chọn model theo đầu vào + kết quả mong muốn. Model chỉ lộ ra khi nó thật sự đổi kết quả (chất lượng/giá), và luôn đổi được.
3. **Mọi kết quả là một bước có thể rẽ nhánh.** Bấm vào kết quả là thấy "làm gì tiếp" (tool, "+" bên phải), không phải "chỉnh model lại".
4. **Chỉ hỏi khi mơ hồ.** Hai ảnh nối vào video: hỏi "đầu/cuối hay tham chiếu?". Một ảnh: không hỏi.

## 2. Soi prototype hiện tại

| Điểm tương tác | Hiện tại | Đang là | Đề xuất |
|---|---|---|---|
| Thêm node (rail "+", nhấp đúp) | Menu theo **loại node**: Text / Image / Video / Audio / Sticky | Loại-node-first | Menu theo **xuất phát điểm**: *Từ ý tưởng* (Text), *Từ file có sẵn* (upload → media), *Từ mẫu* (template). Loại node là hệ quả; vẫn có mục "Node khác" cho người quen. |
| Node trống "Try…" | Quick action của Lumina (i2v, combine, elaborate…) | Flow-first | Giữ. Viết lại theo **kết quả**: "Make a video from an image", "Rewrite this text". |
| "+" hai bên node | Thêm node nối sẵn, lọc theo kiểu | Flow-first | Giữ. Nhãn là **bước tiếp theo**: "→ Make video", "→ Describe", "→ Voice-over", "→ Note". |
| Chân Composer | `[Model ▾] [chip tham số…] [Advanced] [1×] [Billing] [Run]`. Model đứng đầu, bảng giá theo model | **Model-first** | `[Ý định/mode] [chip kết quả: tỉ lệ · thời lượng · số lượng] [Advanced ▸] [1×] [≈ credits] [Run]`. Model là chip nhỏ cuối hàng: **"Auto · Seedream 5"**, bấm mới đổi. Bảng giá vào Advanced. |
| Tab mode (Video/Audio) | "First & last frame / Omni reference / Video editing / Video extension" = `inference_type` của model | Model-first | **Suy từ dây nối** và hiện thành một dòng: "Từ 1 ảnh → video", "Sửa video đang nối". Chỉ hiện lựa chọn khi mơ hồ (2 ảnh: đầu/cuối hay tham chiếu). Có "Đổi ▾" cho người muốn ép. |
| Chip đầu vào (RefTray) | Tên node nguồn, × để gỡ dây | Flow-first | Giữ. Thêm **vai trò** trên chip (First frame · Reference · Source), bấm để đổi. Đây là thông tin flow user quan tâm, Lumina không có. |
| Text node | Popover: model → effort → system prompt | Vẫn model-first | Hàng đầu là **ý định**: Enrich prompt · Describe · Script · Ad copy · Custom. Model/effort/system vào Advanced. "Use this node's text" giữ. |
| Chạy | ⌘Enter / Run trên node đang chọn | Node-first | Thêm cấp **flow**: *Run* · *Run from here* (node này và các node sau) · *Run all*. Node phía sau có badge **"changed"** khi upstream đổi. Ước tính credit cho cả phạm vi sắp chạy. |
| Kết quả → node sau | Chọn ảnh đang dùng, lịch sử ‹ › | Flow-first | Giữ. Ghi rõ "bản này được dùng cho các node sau"; đổi bản → node sau "changed". |
| Tool trên kết quả | Tạo node mới mang tên tool, tự chạy | Flow-first | Giữ. Chỉ hiện tool làm được thật. Tên node theo **kết quả** ("Upscaled", "Vocals"), không theo tên model. |
| Đổi model tự động + Undo | Khi input không hợp | Flow-first | Giữ. |
| Node media thường | Chỉ tool, không prompt | Flow-first | Giữ. |
| Credit | Pill Billing + bảng giá model | Model-first | Giữ "≈ N credits" cho lần chạy. Bảng giá vào Advanced. |

Tóm lại: **khung node, "+", quick action, tool, lịch sử, media node đã flow-first.** Ba chỗ còn model-first và quyết định nhiều nhất là **chân Composer, tab mode, và cách thêm node**.

## 3. Ngữ pháp flow cần chốt (6 động từ)

| Động từ | User làm | Hệ thống làm |
|---|---|---|
| **Bắt đầu** | Gõ ý tưởng, thả file, hoặc chọn mẫu | Tạo node đúng loại; file → media node; ý tưởng → Text |
| **Nối** | "+" hai bên, kéo handle, thả file lên node | Chọn port, mode, model. Chỉ hỏi khi mơ hồ. Từ chối kèm lý do nếu không hợp |
| **Chạy** | Run / Run from here / Run all, ⌘Enter | Ước tính credit theo phạm vi; đánh dấu "changed" cho node sau |
| **Rẽ nhánh** | Tool trên kết quả, "+" sau kết quả, chọn 1 trong nhiều ảnh | Node mới nối lineage/data; không sửa đè bản gốc |
| **Lặp** | Re-edit, Generate again, 1×–4× | Mục lịch sử mới; bản đang dùng đổi được |
| **Dùng lại** | Lưu flow thành template / app *(để sau)* | Các ô cần điền = chỗ user đã chạm trong flow |

Mọi tính năng mới của node phải trả lời được: nó thuộc động từ nào.

## 4. Đã chốt (2026-10-04)

| Điểm | Quyết định | Trạng thái trên prototype |
|---|---|---|
| Model | **Auto** mặc định ("Auto · Seedream 5.0 Pro"); chọn tay thì ghim. Vị trí: sau khi thử ở space, bạn chốt lại chip model **đứng đầu hàng** (feedback #30) — Auto vẫn là điểm chính, thứ tự chip là phụ | Đã sửa |
| Billing / credit | **Bỏ hẳn khỏi UI** (badge trên node, pill, bảng giá, toast, "spent"). Tool nội bộ; credit chỉ quay lại nếu cần làm hạn ngạch | Đã sửa |
| Seed | **Bỏ hẳn** (ô Seed trong Advanced, "· seed N" trong lịch sử node, dòng Seed ở chi tiết run, `RunEntry.seed`). Mỗi run là một vòng lặp agent tự viết lại prompt và chọn model, nên seed không tái tạo được kết quả; làm lại thì dùng công thức cuối đã lưu của run. Chỉ còn ý nghĩa với workflow kiểu ComfyUI | Đã sửa |
| `@` trong prompt | Autocomplete như code editor; **danh sách theo loại node**: Text gọi mọi input; Image gọi ảnh/text + màu; Video gọi ảnh/video/audio; Audio gọi text/audio | Đã sửa |
| Text node | **Preset ý định** là hàng đầu (Custom · Ad copy · Enrich prompt · Describe media · Script); model/effort xuống mục "Model" bên dưới | Đã sửa |
| Tab mode (Video/Audio) | **Giữ tường minh.** Model quá phức tạp, nhiều loại tham chiếu, không đoán được | Giữ nguyên |
| Menu thêm node | **Giữ theo loại node.** Chưa cần gợi ý "Bắt đầu từ…" | Giữ nguyên |
| Run / Run from here / Run all, badge "changed" | **Scope khác**, thiết kế sau khi chốt node | Chưa làm |
| Vai trò trên chip đầu vào | **Làm.** Mỗi input có một vai trò theo loại node + mode; tự xếp khi nối, xếp lại khi đổi mode, bấm để đổi (slot đầy thì hoán đổi), thiếu chỗ thì chip đỏ và khoá Run. Vai trò = port trong recipe khi ghép vào contracts | Đã sửa |
| Ẩn tool chưa có worker | Chưa bàn | Chưa làm |
