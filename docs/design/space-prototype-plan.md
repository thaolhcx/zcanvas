# Kế hoạch: prototype 3 space Image · Video · Audio (feed + composer)

Ngày 2026-10-04. Mục tiêu: dựng **ba trang gen riêng** trong prototype để thử concept "user làm việc với flow, không với model", theo cách Lumina làm ở `/model/image`, `/model/video`, `/model/audio`.

Tham chiếu bắt buộc đọc trước khi làm:
- Hành vi và ảnh chụp: [docs/research/lumina-spaces/lumina-spaces-spec.md](../research/lumina-spaces/lumina-spaces-spec.md) (20 ảnh `I*`, `V*`, `A*`), [phần 2](../research/lumina-apps/lumina-apps-image-video-spec.md) §2 (feed card, modal chi tiết).
- Quyết định đã chốt về node/composer: [node-prototype-summary.md](node-prototype-summary.md), [node-flow-interaction.md](node-flow-interaction.md) §4.
- Góp ý đã xử lý (đừng làm ngược lại): [prototype-feedback.md](prototype-feedback.md).

---

## 0. Nguyên tắc cứng

1. **Không viết composer thứ hai.** Dùng `Composer` trong `web/src/kit/Composer.tsx` với `layout="wide"`. Thiếu gì thì thêm vào kit (có cờ/prop), không copy.
2. **Space = một node ẩn trên canvas.** Mỗi space là một node `page:<kind>` trong `useProto` (đã có trong `GenPage.tsx`). Feed = `node.history`. Không tạo store mới.
3. **Không billing** (badge, giá, "spent", bảng giá). Lumina có; mình là tool nội bộ.
4. **Model mặc định Auto**, chip model đứng **cuối** hàng. Không hiện tham số model lên đầu.
5. **Theme sáng** như prototype hiện tại (Lumina tối; mình chưa quyết theme).
6. Mọi thay đổi phải `pnpm typecheck` sạch và nhìn được trên `http://127.0.0.1:5173/prototype.html` (tab "Spaces").
7. Chỉ dữ liệu giả (`generate.ts`), không gọi backend.

## 1. Kết quả mong muốn (một câu)

Bấm tab **Spaces** → chọn **Image / Video / Audio** → thấy **feed** các lần chạy (mới nhất dưới cùng) và **composer dính đáy**; gõ prompt, kéo tham chiếu, Run → thẻ mới xuất hiện với spinner → kết quả; **Re-edit** đổ lại composer, **Regenerate** chạy lại y nguyên, 🗑 xoá; click kết quả mở **modal chi tiết** có Clone & try; dock **History** bên phải lọc theo thời gian/loại.

## 2. Bố cục (theo ảnh I02, V02, A07)

```
┌ tabs ─┐ ┌──────────── feed (cuộn, mới nhất dưới) ────────────┐ ┌ dock ┐
│ Image │ │ 10:46  [Prompt · Idea] as a cute 3D clay figurine…   │ │History│
│ Video │ │        Auto · Seedream 5.0 Pro · 1:1 · Advanced ⓘ    │ │ ░░░░ │
│ Audio │ │        ┌──────┐                                      │ │ ░░░░ │
│       │ │        │ ảnh  │ ⋯                                    │ │      │
│       │ │        └──────┘                                      │ │      │
│       │ │        [✎ Re-edit] [↻ Regenerate] [🗑]               │ │      │
│       │ └──────────────────────────────────────────────────────┘ └──────┘
│       │ ┌──────────────── Composer layout="wide" ───────────────┐
│       │ │ [slot +] prompt… (@ autocomplete)                  [⤢] │
│       │ │ [chip kết quả…] [Advanced] [Auto · model ▾]   [1×] [▶] │
│       │ └────────────────────────────────────────────────────────┘
```

- Tab trái = ba space (và Text, giữ như `GenPage` hiện có nhưng để cuối).
- Feed căn giữa, rộng tối đa ~880px; thẻ cách nhau 48px như Lumina.
- Composer dính đáy, rộng bằng feed.
- Dock phải mặc định **đóng**, có nút `History` góc trên phải để mở (Lumina: Explore | History; mình chỉ làm History).

## 3. Việc cần làm, theo thứ tự

Mỗi bước là một commit riêng. Sau mỗi bước chụp màn hình so với ảnh tham chiếu ghi trong bước đó.

### Bước 1 — Khung trang và tab (ảnh I01, A01)
- Đổi tên `GenPage` → `SpacesPage` (file `web/src/prototype/GenPage.tsx` → `SpacesPage.tsx`); tab trên `main.tsx` ghi "Spaces".
- Thứ tự tab: Image · Video · Audio · Text. Nhớ tab đã chọn trong `localStorage` (`proto.space`).
- Trạng thái trống: tiêu đề giữa màn hình "Light up your creation" (A01) thay cho đoạn giải thích hiện tại.
- Node ẩn `page:<kind>` tạo lười như hiện nay.
- **Nghiệm thu:** chuyển tab không mất lịch sử của tab khác; reload vẫn ở tab cũ.

### Bước 2 — Thẻ feed (ảnh I02, V02; phần 2 §2.1)
Sửa `RunCard` trong `web/src/kit/results.tsx` (dùng chung với node) hoặc tạo `FeedCard` trong kit nếu khác nhiều:
- Dòng 1: **timestamp** `YYYY-MM-DD HH:mm:ss` (màu nhạt).
- Dòng 2: **prompt** đầy đủ, trong đó token `@…` hiện thành **chip có thumbnail** (dùng `refs` lưu kèm entry — xem bước 4).
- Dòng 3: chip meta, cách nhau bằng `|`: `Auto · <model>` (hoặc tên model nếu ghim) · các chip tham số inline đang có giá trị (1:1, 480p, 4s, Voice: Daisy…) · `Advanced ⓘ` (hover hiện bảng tham số advanced của lần chạy đó).
- Kết quả: ảnh/video/audio theo `ResultView size="card"`; nhiều ảnh thì xếp hàng ngang (I02 là 1 ảnh; Lumina 4 ảnh xếp ngang).
- Hover kết quả → nút **⋯** góc trên phải với menu: Download · Open in canvas (toast "not in this prototype") · Delete.
- Hàng nút: `✎ Re-edit` · `↻ Regenerate` · `🗑`.
- Đang chạy: thẻ xuất hiện ngay với `StatusOverlay` và nút **⊘ Stop** thay cho hàng nút (phần 2 §2: "Terminate generation").
- Bị huỷ: thẻ còn lại, kết quả thay bằng dòng `cancelled` nhạt (V02), vẫn có Re-edit.
- **Không có** `N cr`, không giá.
- **Nghiệm thu:** so với I02 từng dòng; thẻ huỷ giống V02.

### Bước 3 — Hành vi Re-edit / Regenerate / Delete
- **Re-edit**: `source.reEdit(entryId)` (đã có) + đổ lại **cả tham chiếu** (uploads) của lần đó; cuộn composer vào tầm nhìn; toast "Filled in parameters" (I05).
- **Regenerate**: Re-edit rồi `run()` ngay, **không** đổi composer hiện tại của user (chạy từ bản sao `entry.value` + `entry.refs`). Cần thêm `run(value?, refs?)` vào store hoặc một action `rerun(id, entryId)`.
- **Delete**: xoá entry khỏi `history`; nếu đang là `active` thì chuyển sang entry mới nhất.
- Composer **giữ** prompt và tham chiếu sau khi Run (Lumina làm vậy; prototype node hiện cũng giữ).
- **Nghiệm thu:** Regenerate 2 lần ra 2 thẻ, composer không đổi; Re-edit đổ đúng prompt + slot.

### Bước 4 — Lưu tham chiếu theo lần chạy
- `RunEntry` thêm `refs: RefItem[]` (snapshot inputs lúc chạy). Store `run()` ghi vào entry. Dùng để vẽ chip trong thẻ và để Re-edit đổ lại.
- Thẻ hiện thumbnail tham chiếu trong dòng meta ("Reference images" với thumb, I02).

### Bước 5 — Slot tham chiếu bên trái composer (ảnh I01, V03, A05)
Trong `Composer` layout `wide`, `RefTray` đổi hình: một **ô vuông** có `+` bên trái ô prompt (như Lumina), trống ghi `image` / `material` / `Voice` tuỳ space:
- Hover/bấm `+` → menu: **Upload** · **From library** (Image, Audio); Video thêm **Portrait Gallery** và **Director's Desk** nhưng chỉ toast "not in this prototype".
- Đã có tham chiếu → thumbnail xếp chồng, badge `+N`, bấm mở danh sách chip (có vai trò, ×) như trên node.
- Audio với Seed Speech: slot là **Voice** → mở thư viện giọng (đã có `VoicePicker`).
- Giữ nguyên `RefTray` dạng chip cho `layout="compact"` (node). Thêm prop `variant: "chips" | "slot"`.
- **Nghiệm thu:** so với I01/A07 phần slot; chọn 2 ảnh thấy `+1`.

### Bước 6 — Audio: Vibe + Text (ảnh A07, A10)
- Trong catalog, model `seed-tts` (TTS) thêm field `vibe` (`type: "string"`, `placement: "inline"`, label "Vibe prompt", placeholder *"(Optional) Input your preferred speech style, for example: extremely happy"*).
- Composer `wide` cho Audio TTS: hiển thị **hai ô** xếp dọc: `Vibe Prompt` (1 dòng, optional) và `Text` (ô prompt chính). Cách làm: `NodeSpec.promptLayout?: "single" | "vibe+text"`; kit render thêm ô trên khi `vibe+text`.
- Nút chip **Auto prompt** (tooltip *"Automatically create matched vibe prompts"*): điền `vibe` giả từ text (vd lấy 3 từ đầu + "tone"). Chỉ UI.
- Áp dụng luôn cho **node Audio trên canvas** ở mode t2a (layout compact: ô Vibe thu thành 1 dòng trên ô Text).
- **Nghiệm thu:** A07.

### Bước 7 — Modal chi tiết (ảnh I03; phần 2 §2.2)
- Click kết quả trong feed → modal toàn màn hình: trái = `Lightbox` đã có (zoom, 1:1, xoay, tải); phải = model, prompt có chip, chip tham số, **bảng tham số** (params + `seed`), "Generated on …", nút **✦ Clone & try** (= Re-edit rồi đóng modal); cột phải cùng = filmstrip dọc các entry khác để lật (↑↓ hoặc click).
- Không có author/views/likes (không phải cộng đồng).
- **Nghiệm thu:** so với I03.

### Bước 8 — Dock History (ảnh A06, I02 cột phải)
- Nút `History` góc trên phải feed (A01). Mở panel phải rộng ~300px, đẩy feed co lại.
- Ô tìm "Prompt keywords" · `Time ▾` (Today / 7 days / All) · `Type ▾` (Image / Video / Audio / Text) · lưới masonry 2 cột gồm **toàn bộ** entry của mọi space (không chỉ space đang mở).
- Click một ô → mở modal chi tiết (bước 7) của entry đó; từ modal "Clone & try" sẽ **chuyển sang space đúng loại** rồi đổ composer.
- **Nghiệm thu:** từ Audio tìm được ảnh của Image; Clone & try nhảy sang Image.

### Bước 9 — Chi tiết nhỏ
- Composer giữ nguyên thứ tự chốt: chip kết quả → Advanced → `Auto · model` → 1× → ▶. Chip đầu hàng **không** phải "AI Image ▾" (mình đã có tab trái).
- Phím ⌘Enter chạy; feed tự cuộn xuống thẻ mới.
- Toast "Generated successfully, time-consuming X s" (đã có).
- Mobile/hẹp: dưới 900px dock ẩn, tab trái thành hàng trên.

## 4. Không làm trong vòng này

Explore (cộng đồng) · Director mode · Artboard/Draw · Share link · Collect · Agent/Canvas Agent (sẽ là vòng sau, xem [lumina-agent-chat-spec.md](../research/lumina-agent/lumina-agent-chat-spec.md)) · "Open in canvas" thật (chỉ toast).

## 5. Checklist nghiệm thu cuối

- [ ] Ba space chạy end-to-end với dữ liệu giả; Text vẫn chạy.
- [ ] Composer dùng chung với node (sửa ở node thấy ở space và ngược lại).
- [ ] Không có bất kỳ chữ/ số nào về credit, giá, billing.
- [ ] Re-edit / Regenerate / Delete / Stop đúng mô tả bước 3.
- [ ] Modal chi tiết có bảng tham số + seed + Clone & try + filmstrip.
- [ ] History dock lọc được theo chữ/thời gian/loại và nhảy đúng space.
- [ ] Audio TTS có Vibe + Text + Auto prompt, cả ở space lẫn node.
- [ ] `pnpm typecheck` sạch; ảnh chụp từng bước đặt vào `docs/design/space-prototype-shots/` để đối chiếu.
- [ ] Ghi các góp ý/thay đổi vào `prototype-feedback.md` (tiếp số #21…).

## 6. File sẽ đụng

| File | Việc |
|---|---|
| `web/src/prototype/GenPage.tsx` → `SpacesPage.tsx` | khung trang, tab, feed, dock, modal |
| `web/src/kit/results.tsx` | `RunCard`/`FeedCard`, `StatusOverlay` thẻ đang chạy |
| `web/src/kit/Composer.tsx` | `RefTray variant="slot"`, `promptLayout "vibe+text"`, nút Auto prompt |
| `web/src/kit/types.ts` | `RunEntry.refs`, `NodeSpec.promptLayout` |
| `web/src/prototype/store.ts` | `run()` lưu refs; `rerun(id, entryId)`; `removeEntry` |
| `web/src/prototype/catalog.ts` | field `vibe` cho TTS |
| `web/src/prototype/proto.css`, `web/src/kit/kit.css` | layout feed/dock/slot |
| `web/src/prototype/main.tsx` | tab "Spaces", seed vài entry cho feed demo |
