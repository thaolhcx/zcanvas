# BytePlus Lumina — cách họ làm "chat" (Agent, Canvas Agent, feed Image/Video)

Phần 3 của nghiên cứu Lumina. Phần 1: [5 node canvas](../lumina/lumina-nodes-spec.md). Phần 2: [trang Image/Video + AI Apps](../lumina-apps/lumina-apps-image-video-spec.md).

| | |
|---|---|
| Xem ngày | 2026-10-04, `ai.byteplus.com/lumina/en/agent`, `/agent/<id>`, `/storyboard?id=…`, `/canvas/<id>` (Canvas Agent) |
| Cách làm | Dùng UI, đọc một phiên Agent đã có sẵn trong History ("Whispers of the Heart", 2026-08-21). **Không gửi tin nhắn mới, không bấm Generate** → 0 credit. |
| Ảnh | 28 ảnh trong [`img/`](img/) |
| Chưa xem | Gửi một yêu cầu thật cho Canvas Agent để xem nó dựng node ra sao (tốn token); trang Video của Agent (chưa gen video); "Open Skills" / Create Skill. |

---

## TL;DR

Lumina có **ba** thứ "kiểu chat", và chúng khác nhau về mục đích:

| | Trang Image / Video (`/model/image`) | **Agent** (`/agent`) | **Canvas Agent** (panel trong canvas) |
|---|---|---|---|
| Là gì | Feed các lần gen + composer dính đáy | Agent làm **trọn một video** từ một chủ đề: hỏi lại → kịch bản → storyboard → video | Chat **bên cạnh canvas**, dựng và chạy **node** theo yêu cầu |
| Một tin nhắn = | Một lần gen (1 model, 1 kết quả) | Một bước hội thoại; agent tự chạy nhiều bước | Một yêu cầu; agent tạo/sửa/chạy node trên canvas |
| Tham chiếu | `@Image001`, `@Region01` | Đính kèm ảnh/audio ở tin đầu; `@` trong storyboard gọi nhân vật/bối cảnh | `@` gọi **node trên canvas**, `/` gọi **skill**, + thêm từ canvas / upload / assets |
| Model | Chọn tay, chip đầu hàng | **Không hiện model**; chỉ tỉ lệ · thời lượng · phong cách · ngôn ngữ | LLM của agent chọn được (GPT-5.5…); model gen **Auto** mặc định, panel riêng |
| Kết quả | Thẻ trong feed | Panel bên phải: Story → Storyboard → Video | Node trên canvas |
| Gần với ý "chat space" của mình | Gần nhất về **gen nhanh** | Gần nhất về **"user nói ý định, không chọn model"** | Gần nhất về **quan hệ chat ↔ canvas** |

Kết luận cho zcanvas ở §5.

---

## 1. Agent (`/agent`) — "Turn any topic into a captivating video"

### 1.1 Trang vào — [01](img/01-agent-home.jpg)

- Một ô nhập lớn: *"Describe a topic, idea, or concept you want to explain."* Bên trái ô có nút **image** (local upload / material library — [11](img/11-agent-home-image-attach-menu.jpg)).
- Hàng chip dưới ô, **không có model**: `9:16 ▾` (16:9, 9:16, 4:3, 3:4, 1:1… — [13](img/13-agent-home-ratio-menu.jpg)) · `Duration ▾` (Auto, ~30s, ~45s, ~60s — [08](img/08-agent-home-duration-menu.jpg)) · `Style ▾` ("Art Style List": Auto, Cinematic, 3D Cartoon, Anime, Clay… — [09](img/09-agent-home-style-list.jpg)) · `Language ▾` (Auto, English, Chinese, Japanese — [10](img/10-agent-home-language-menu.jpg)).
- Bốn **template chip**: Music Video · Explainer Video · UGC Video · Product Video Ads. Bấm thì chèn một **tag** vào ô nhập ("Explainer Video ×") và đổi URL `?mode=video_commentary` — [12](img/12-agent-home-template-chip-explainer.jpg). Tức là template = một mode của agent, không phải prompt mẫu.
- "Made with AI Agents": gallery kết quả cộng đồng, lọc theo 4 loại.
- **History** (góc trên trái) mở panel danh sách phiên: tiêu đề + yêu cầu đầu tiên; "View all in Assets" — [02](img/02-agent-history-panel.jpg).

### 1.2 Một phiên Agent — [03](img/03-agent-session-chat-and-story-panel.jpg), [04](img/04-agent-session-top-upload-and-clarify.jpg)

Bố cục hai cột: **chat bên trái**, **tài liệu bên phải**; nút **Preview Storyboard** góc trên phải.

Diễn biến phiên "Whispers of the Heart":

1. User: đính kèm `Music.mp3` (thẻ audio có ▶, 0:00/3:01, 2.8MB) + "Make video music based uploaded music".
2. Agent **hỏi lại** (chủ đề? phong cách?). Mỗi lượt trả lời của agent kèm **thẻ thiết lập** hiện trạng thái đã chốt: `Video Ratio 16:9 · Style Auto`.
3. User: "2D anime style," → agent xác nhận, thẻ đổi `Style 2D anime style`, hỏi tiếp về câu chuyện.
4. User: "a romantic love story," → agent chốt và chạy **Creative Workflow**, hiện danh sách bước có ✓:
   - Understanding the Topic — *Captured the core theme and target audience*
   - Analyze Music — *Extract audio file details from the input*
   - Generating Script Outline — *Built the story structure…*
   - Generating Storyboard Script — *Refined shot breakdown and scene scripts*
   - Visualizing the Storyboard — *Generated visual previews and layout*
5. Một **thẻ tài liệu** "Whispers of the Heart · 2026/08/21 08:39" xuất hiện trong chat; panel phải hiện nội dung.
6. Agent: *"Your story is ready. Are you happy with this version? If yes, click Generate Storyboard… If you'd like to make changes, tell me what you want to revise in the chat below, and I'll update the story first."*

Composer cuối chat: "Send message", có nút `@` và gửi.

**Panel tài liệu (Story)** — [05](img/05-agent-story-panel-storyboard-script.jpg): Story Brief · Visual Style · **Subject List** (mỗi nhân vật có mô tả + **character sheet** ảnh) · **Scene List** (mỗi bối cảnh có mô tả + ảnh) · **Storyboard Script** (18 scene, mỗi scene một câu).

### 1.3 Storyboard stage (`/storyboard?id=…&mode=scenes`) — [06](img/06-storyboard-stage-scene1-prompt-grid.jpg), [07](img/07-storyboard-stage-scene2-at-tokens.jpg)

- Header: `‹ Back to Script Planning` · tab **Storyboard | Video** (Video khoá: *"Click the Generate Video button first"*) · `Regenerate all storyboards ✦144` · `Generate videos`.
- Cột trái: **Scene description** (câu của agent) → **Storyboard prompt** (*"Type @ to add characters or props"*): một đoạn prompt dài do agent viết, trong đó nhân vật/bối cảnh là **token `@Haru`, `@Cozy Apartment`** có avatar; phía trên có hàng thumbnail nhân vật/bối cảnh để kéo vào. Nút `Generate Image ✦8`.
- Cột phải: ảnh **lưới 2×2** (storyboard sheet 4 panel) cho scene đang chọn.
- Dải dưới: filmstrip 18 scene kèm thời lượng (00:15, 00:10, …, 00:06.15) — tổng khớp độ dài bài nhạc.

→ Agent **không giấu** prompt: nó dịch câu chuyện thành prompt có token tham chiếu, và user sửa được từng scene trước khi tốn credit.

---

## 2. Canvas Agent (panel trong canvas) — [16](img/16-canvas-agent-panel-new-chat.jpg)

Mở bằng nút ✦ góc dưới phải canvas. Panel bên phải, tiêu đề "New Chat", icon: new chat · **Chat History** ("No Chat History" khi mới — [22](img/22-canvas-agent-chat-history-empty.jpg)) · ×.

| Phần | Chi tiết |
|---|---|
| Màn trống | "Start Creating with Canvas Agent" + 10 chip **skill** + `more` |
| Composer | Placeholder: *"Enter an idea, or enter "@" to quote material, "/" to quote skills…"* |
| `@` | Menu "Possible @content" → **Node** (N nodes) → chọn node trên canvas — [19](img/19-canvas-agent-at-quote-node.jpg) |
| `/` | Danh sách **Available Skills** (tên + một dòng mô tả) — [20](img/20-canvas-agent-slash-skills.jpg) |
| `+` | **Add from Canvas** · Upload Files · Select from Assets — [21](img/21-canvas-agent-attach-menu.jpg) |
| Icon sách | Picker **Skill**: tab Skills / Favorite / My Skills, tìm kiếm, sắp xếp, `+ Create Skill` — [24](img/24-canvas-agent-skill-picker.jpg) |
| Icon khối | Panel **Model**: tab Image / Video, công tắc **Auto** (bật mặc định), danh sách model có checkbox (GPT Image 2, Seedream 5.0 Pro/Lite…; Seedance 2.5/2.0/2.0 fast…) — [25](img/25-canvas-agent-model-panel-image-auto.jpg), [28](img/28-canvas-agent-model-panel-video-auto.jpg) |
| `Manual mode ▾` | **Manual mode** — *Builds the workflow after confirming your needs; manual run required* · **Auto mode** — *Executes automatically and outputs results directly* — [17](img/17-canvas-agent-manual-vs-auto-mode.jpg) |
| `GPT-5.5 ▾` | LLM của agent: GPT-5.5, Dola-Seed-2.1-turbo, Gemini-3.1-Pro-preview, Gemini-3.5-Flash, GLM-5.2, GLM-5V-Turbo, GLM-5.3 — [18](img/18-canvas-agent-model-list.jpg) |

**Add to dialog box** (chuột phải node — [15](img/15-canvas-node-context-menu-add-to-dialog.jpg)): mở panel và chèn chip **`@Audio Generation`** vào composer — [23](img/23-canvas-agent-add-to-dialog-result-chip.jpg). Tức là node là một *vật* có thể nhắc tới trong chat; agent sẽ đọc/sửa/nối từ node đó.

**Skills** — [26](img/26-canvas-agent-skills-library.jpg), [27](img/27-canvas-agent-skill-detail.jpg): thư viện thẻ (Gameplay PV Builder, Koreeda Film Aesthetic, Viral Content Cloner, Wes Anderson Short Film, Industrial Procedure-to-Video, Soft Dreamy Portrait Collage, Bold Torn-Paper Photo Cover, Cobalt Blue Studio Portrait…), lọc theo Commercial Ads / Short Dramas / Film & TV / Anime & Games, tag loại kết quả (Image/Video) và scene tag. Chi tiết skill: ảnh mẫu, "Brief introduction" một câu, classification, `Use Skills`, `Open Skills`. Trang canvas ghi: *"Select a skill to open it in a new canvas, then tell Canvas Agent what you need"* — [14](img/14-canvas-home-agent-skills.jpg). Skill ≈ **playbook** cho agent (cách dựng flow), gần với "template publish thành app" của mình nhưng điều khiển bằng chat.

---

## 3. Feed Image/Video (nhắc lại, chi tiết ở phần 2)

Feed = lịch sử; thẻ = prompt (có chip) + model + tham số + kết quả; Re-edit · Regenerate · 🗑; ⋯ Video Editing / Draw / Download; composer giữ prompt sau khi gửi để lặp. Đây là "gen nhanh" của Lumina và **không có agent**.

---

## 4. Những gì Lumina làm đúng (nên theo) và chưa ổn (nên tránh)

**Theo:**
1. **Hỏi lại trước khi tốn tiền.** Agent hỏi 2 câu rồi mới chạy; mọi bước đắt (storyboard, video) đều có nút riêng và user xem trước.
2. **Thẻ trạng thái đã chốt** đi kèm mỗi lượt (Ratio · Style) — user luôn biết agent đang hiểu gì.
3. **Danh sách bước có ✓** khi agent chạy nhiều bước — không phải spinner mù.
4. **Tài liệu tách khỏi chat** (panel phải): chat để nói, panel để xem/sửa; chat không bị lấp bởi kết quả dài.
5. **Node là vật nhắc được** (`@Node`), skill là động từ (`/skill`). Ba cách thêm chất liệu: từ canvas, upload, assets.
6. **Model Auto mặc định**, chọn tay là panel riêng — đúng hướng mình vừa chốt.
7. **Manual / Auto mode**: dựng flow rồi để user chạy, hay chạy luôn. Đây là câu trả lời cho "Run" của mình ở cấp agent.
8. Template chip **chèn tag vào ô nhập** thay vì điền prompt mẫu — ý định ở dạng dữ liệu, không phải chữ.

**Tránh:**
- Agent chỉ làm **video dài có kịch bản**; không dùng được cho "sửa ảnh này nhanh". Lumina phải có 3 bề mặt vì thế.
- Agent và trang Image/Video và canvas là **3 lịch sử rời nhau** (History của Agent, History của feed, Chat History của canvas).
- Composer của Agent **không cho chọn gì ngoài 4 chip**; sửa ở storyboard stage mới thấy prompt thật.

---

## 5. Gợi ý cho zcanvas "chat space"

Không nên bê nguyên một trong ba. Ghép như sau:

| Lấy từ | Gì |
|---|---|
| Canvas Agent | **Chat ở cạnh canvas, cùng một dữ liệu.** `@node` để nhắc, `/skill` cho playbook, Manual/Auto mode. Mỗi tin có thể tạo/sửa/chạy node — không phải một bề mặt gen riêng. |
| Agent | **Hỏi lại khi thiếu**, thẻ "đã chốt", bước có ✓, tài liệu (brief/subject/scene) ở panel riêng khi flow dài. |
| Feed Image/Video | **Kết quả hiện ngay trong chat** cho yêu cầu ngắn ("sửa màu áo"), có Re-edit / Regenerate. |
| Của mình | Chip vai trò (First frame · Source…), token theo id, không billing. |

Nghĩa là **chat space = Canvas Agent của mình**: một panel chat trên chính canvas (và có thể mở "toàn màn hình" khi không cần nhìn node), mỗi tin nhắn là một bước flow; tin ngắn trả kết quả tại chỗ, tin dài sinh node + tài liệu. Canvas vẫn là nơi rẽ nhánh; chat là cách nhanh để nói ý định.

Việc còn thiếu để chốt: **gửi một yêu cầu thật cho Canvas Agent** (Manual mode) để xem nó dựng node, nối dây, đặt tên và hỏi lại ra sao. Tốn token LLM (ai_chat tính theo token, không tốn credit gen nếu không chạy).
