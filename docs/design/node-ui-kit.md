# Node UI kit: giao diện dùng chung cho canvas node và trang Gen riêng

> Mục tiêu: UI của 5 node (Text, Image, Video, Audio, Sticky) viết **một lần** rồi dùng lại được ở:
> 1. **Canvas node** (hiện có)
> 2. **Trang Gen riêng** (Image/Video page kiểu Lumina, sẽ làm sau)
> 3. **Form app** (template publish thành app)
>
> Spec node và params: [node-specs-v2.md](node-specs-v2.md). Tham khảo Lumina: [part 1](../research/lumina/lumina-nodes-spec.md), [part 2](../research/lumina-apps/lumina-apps-image-video-spec.md).

---

## 1. Hiện trạng và vấn đề

| File | Đang dính vào |
|---|---|
| `web/src/Params.tsx` (`ParamField`, `ParamForm`) | `useGraph()` → `graph.setParam`, `useCanvas` (fieldErrors, templateInputs), `acceptedMediaKinds(graph…)` |
| `web/src/BaseNode.tsx` (`Preview`, `Status`, `Thumb`, `ConnectionPoint`) | React Flow `Handle`, `useRun` (jobs của run trên canvas), `useCanvas.byId`, `PortPaletteContext` |
| `web/src/store.ts` | State của một canvas: một graph, một run |

Vì vậy nếu bê sang trang Gen riêng thì sẽ phải viết lại form, preview và trạng thái. Lumina cũng tách hai nguồn schema (canvas và standalone), dẫn tới **mặc định khác nhau cho cùng một model**. Mình không nên lặp lại lỗi đó.

---

## 2. Kiến trúc 4 lớp

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 4. SHELL (bố cục theo nơi dùng)                                           │
│    CanvasNodeShell (React Flow)   GenPageShell (feed+composer)   AppForm  │
├──────────────────────────────────────────────────────────────────────────┤
│ 3. ADAPTER (nối dữ liệu)                                                  │
│    canvasAdapter(graph, nodeId)    pageAdapter(localStore)   appAdapter   │
│              └───────────── cùng implement GenSource ─────────────┘       │
├──────────────────────────────────────────────────────────────────────────┤
│ 2. UI KIT (component "controlled", chỉ nhận props)                        │
│    Composer · PromptEditor · RefTray · ModelPicker · ParamChips · ...     │
├──────────────────────────────────────────────────────────────────────────┤
│ 1. LOGIC THUẦN (không React)                                              │
│    resolveForm(nodeType, model, value) → field nhìn thấy, placement,      │
│    issues, cost · compilePrompt(parts, refs) · clampOnModelChange()       │
└──────────────────────────────────────────────────────────────────────────┘
```

**Quy tắc cứng** (có lint rule `no-restricted-imports` cho thư mục `web/src/kit/**`):
- Kit **không import** `@xyflow/react`, `graph/`, `store.ts`, `context.ts` hay `media/store.ts`.
- Kit chỉ nhận dữ liệu qua props và trả về qua callback.
- Logic ở lớp 1 nằm trong `contracts/` (hoặc `web/src/kit/logic/`) và test bằng Vitest, **dùng chung với server** (validate, estimate).

---

## 3. Hợp đồng `GenSource` (lớp adapter)

Mọi shell đều chỉ nói chuyện với kit qua interface này:

```ts
export interface GenSource {
  // định nghĩa
  nodeType: NodeType;                       // từ registry
  models: ModelSpec[];                      // catalog đã lọc theo kind
  // giá trị đang sửa
  value: GenValue;                          // { params, mode?, model?, prompt: PromptPart[] }
  setValue(patch: Partial<GenValue>): void; // canvas: graph.setParam trong transaction; page: setState
  // đầu vào
  inputs: RefItem[];                        // canvas: lấy từ edges; page: file upload/thư viện
  addInput?(kind: AssetKind): void;         // page: mở upload / Media browser; canvas: mở palette upstream
  removeInput(id: string): void;            // canvas: graph.disconnect; page: bỏ khỏi tray
  // chạy
  status: GenStatus;                        // empty | ready | queued | running(progress) | done | failed | cancelled
  issues: Issue[];
  estimate: { credits: number; breakdown: PriceLine[] };
  run(times?: 1 | 2 | 3 | 4): void;
  cancel(): void;
  // kết quả
  history: RunEntry[];                      // {id, at, params, seed, outputs, credits, status}
  active?: { entryId: string; index?: number };
  setActive(a: { entryId: string; index?: number }): void;
  actions: ResultAction[];                  // công cụ trên kết quả (crop, upscale…) — xem §6
}

export interface RefItem {
  id: string;               // canvas: edgeId; page: localId
  kind: AssetKind | "text";
  label: string;            // "Image001", tên node nguồn…
  thumbUrl?: string;
  value?: string;           // text upstream
  port?: string;            // cổng nhận (references, firstFrame…)
}
```

| Nguồn | `canvasAdapter` | `pageAdapter` (Gen riêng) | `appAdapter` |
|---|---|---|---|
| value | `node.params` (Yjs) | state cục bộ, lưu nháp | chỉ các ô `template.inputs` |
| inputs | edges vào node | file tải lên / chọn từ thư viện | các ô asset của form |
| run | `POST /runs` với recipe canvas | `POST /runs` với recipe **một node** tạo ngầm | recipe template + giá trị form |
| history | jobs của node qua các run | feed theo trang | output panel |

Trang Gen riêng chỉ là một canvas ẩn **một node**, nên server, worker, cache và lịch sử dùng lại được 100%.

---

## 4. Danh mục component trong kit

| Component | Vai trò | Props chính | Canvas | Gen page | App form |
|---|---|---|:-:|:-:|:-:|
| `Composer` | Khung panel: tabs mode → RefTray → PromptEditor → Footer | `source: GenSource`, `layout: "compact" \| "wide" \| "form"` | ✓ (dưới node) | ✓ (đáy trang) | ✓ |
| `ModeTabs` | Tab mode, khoá kèm lý do | `modes`, `value`, `disabled: Record<mode, reason>` | ✓ | ✓ | – |
| `RefTray` | Chip đầu vào / ảnh tham chiếu, ×, + | `items`, `onRemove`, `onAdd`, `limits` | ✓ | ✓ | ✓ |
| `PromptEditor` | Ô prompt rich, `@` mention, token màu, ⤢ fullscreen | `parts`, `refs`, `onChange`, `placeholder`, `maxLength` | ✓ | ✓ | ✓ |
| `ModelPicker` | Thẻ model: mô tả, badge, khả năng đầu vào, lý do bị khoá | `models`, `value`, `inputsKinds`, `onChange` | ✓ | ✓ | – |
| `ParamChips` | Dải chip inline, sinh từ `resolveForm` | `fields`, `value`, `onChange` | ✓ | ✓ | ✓ |
| `AdvancedPopover` | Các field `placement: advanced`, nút Reset | như trên | ✓ | ✓ | ✓ |
| `fields/*` | Widget theo `Param.type` / format: Enum, Number+Slider, Toggle, Text, Seed, Color, **SizePicker**, **DurationPicker**, **VoicePicker**, **CameraPicker** | `param`, `value`, `onChange`, `error` | ✓ | ✓ | ✓ |
| `CountSelect` | 1×–4× | `value`, `onChange` | ✓ | ✓ | – |
| `CostBadge` | `≈ N credit` + bảng giá khi hover | `estimate` | ✓ | ✓ | ✓ |
| `RunButton` | Run / Stop / disabled kèm lý do, phím ⌘Enter | `status`, `issues`, `onRun`, `onCancel` | ✓ | ✓ | ✓ |
| `ResultView` | Hiển thị kết quả theo kind (§5) | `output`, `kind`, `size: "node" \| "card" \| "full"` | ✓ | ✓ | ✓ |
| `StatusOverlay` | Placeholder đúng tỉ lệ / queued / % / lỗi + Retry | `status`, `aspect`, `error` | ✓ | ✓ | ✓ |
| `RunHistory` | Lịch sử: `strip` (‹ › trong node) hoặc `feed` (thẻ dọc như Lumina) | `entries`, `active`, `variant`, `onReEdit`, `onRerun`, `onSetActive` | strip | feed | – |
| `ResultToolbar` | Nút công cụ (Download, Fullscreen, Crop, Upscale…) | `actions`, `onAction` | ✓ (trên node) | ✓ (menu ⋯ của thẻ) | ✓ |
| `Lightbox` | Xem full: zoom, xoay, video/audio player, tải | `output` | ✓ | ✓ | ✓ |
| `RunDetail` | Params thật, seed thật, "Clone & try" | `entry` | ✓ | ✓ | – |
| `MarkdownNote` | Sticky: render GFM, editor Edit/Preview | `text`, `color`, `onChange` | ✓ | – | ✓ (hướng dẫn) |
| `NodeChrome` | Header, handle, resize, selection | — | **chỉ canvas** | – | – |

`NodeChrome` và handle là phần duy nhất gắn với React Flow; chúng nằm ở `web/src/canvas/`, ngoài kit.

---

## 5. Lắp 5 node từ kit

| Node | Thân node (`ResultView`) | Composer: inline chips | Advanced | Fields đặc thù |
|---|---|---|---|---|
| **Text** | `TextView` (sửa tay được, xem markdown) | preset · model · variants | system · useOwnText · params model | — |
| **Image** | `ImageGrid` (1–4 ảnh, chọn bản đang dùng) | model · **SizePicker** · count | seed · params model | SizePicker, CameraPicker (P2) |
| **Video** | `VideoPlayer` (tự phát tắt tiếng; poster khi zoom thấp) | mode · model · ratio · resolution · **DurationPicker** | audio · seed | DurationPicker |
| **Audio** | `AudioWave` (waveform + scrubber) | mode · model · **VoicePicker** / duration | speed · pitch · volume · style · format | VoicePicker |
| **Sticky** | `MarkdownNote` | (không có Composer) | — | — |

Mỗi node chỉ cần một file mô tả "lắp ráp" ngắn (hoặc không cần nếu dùng hoàn toàn theo registry):

```ts
// web/src/kit/presets/video.tsx
export const videoView: NodeView = {
  result: VideoPlayer,
  fields: { durationSec: DurationPicker },   // ghi đè widget mặc định theo key/format
  emptyActions: ["upload", "imageToVideo"],  // quick actions khi trống
};
```

Node mới (như `audio.sfx` trong `extending.md`) **không cần** NodeView: kit tự render theo `Param.type`.

---

## 6. Hành động trên kết quả (dùng chung, khác nhau theo nơi dùng)

`ResultAction` là dữ liệu: `{ id, label, icon, kind: "local" | "derive", appliesTo: kind[] }`. Shell quyết định "derive" nghĩa là gì:

| Action | Canvas | Gen page |
|---|---|---|
| Upscale / Edit (derive) | Tạo node `image.edit` mới, nối dây | Mở composer với kết quả làm tham chiếu và model `image.edit`; thêm thẻ mới vào feed |
| Dùng làm khung đầu video | Tạo `video.generate`, nối `firstFrame` | Chuyển sang trang Video, đưa ảnh vào RefTray |
| Crop / Trim / Lấy khung hình (local) | Tạo `input.asset` + edge lineage | Lưu asset mới, thêm vào tray / feed |
| Download / Fullscreen | như nhau | như nhau |

Kit chỉ phát ra `onAction(id, output)`; không biết gì về graph.

---

## 7. Ba layout của Composer

| | `compact` (canvas) | `wide` (Gen page) | `form` (App) |
|---|---|---|---|
| Vị trí | Bám dưới node, rộng ~480 | Dính đáy trang, rộng tối đa 900 | Cột trái của trang app |
| RefTray | Chip một dòng | Ô vuông có "+" và chồng ảnh | Ô upload lớn theo từng slot |
| Footer | Chip gọn, tràn thì cuộn ngang và có nút "⋯" | Đủ chip; tràn thì gom vào "⋯" (Lumina bị cắt mất chip, mình không để vậy) | Chỉ các ô template, Advanced cho slot `placement: advanced` |
| History | `strip` trên thân node | `feed` phía trên composer | Output panel |

Responsive: dưới 900 px, chip inline nào không vừa sẽ tự gom vào "⋯", **không bao giờ cắt mất**.

---

## 8. Lộ trình refactor từ code hiện tại

1. **Tách logic** `resolveForm()`, `clampOnModelChange()`, `compilePrompt()` sang `contracts/` và viết test trước. Chưa đụng UI.
2. **Biến `ParamField` thành controlled** (`value`, `onChange`, `error`), chuyển vào `web/src/kit/fields/`. `Params.tsx` cũ trở thành wrapper gọi `canvasAdapter`, để hành vi canvas không đổi. E2E hiện có phải vẫn xanh.
3. **Tách `Preview`/`Thumb`** khỏi `BaseNode.tsx` thành `ResultView` + `StatusOverlay` (props thuần). `BaseNode` chỉ còn `NodeChrome` và lắp kit.
4. Viết `canvasAdapter` (`useCanvasGenSource(nodeId)`) và chuyển panel canvas sang `Composer layout="compact"`.
5. Thêm `/playground` (dev only) render từng component kit với `mockSource` để kiểm tra mà không cần canvas. Đây cũng là bản phác của trang Gen.
6. Khi làm trang Gen: viết `pageAdapter` + `GenPageShell` (feed + composer). **Không phải viết lại component nào.**

---

## 9. Tiêu chí hoàn thành

- [ ] `web/src/kit/**` không import `@xyflow/react`, `graph/`, `store.ts` hay `context.ts` (lint rule chặn).
- [ ] Cùng một `Composer` chạy được với `canvasAdapter` trên canvas và với `mockSource` trong `/playground`, cho cả 4 node có gen.
- [ ] Đổi model ở canvas hay ở playground cho cùng kết quả `resolveForm` (cùng mặc định, cùng giá trị bị kẹp); có unit test.
- [ ] Footer không bao giờ cắt chip ở 768 / 1024 / 1440 px; chip tràn gom vào "⋯".
- [ ] E2E canvas hiện có vẫn pass sau khi `ParamField` thành controlled.
- [ ] Thêm một node type mới chỉ bằng JSON (như `audio.sfx`) vẫn tự có Composer, chip và ResultView mà không phải sửa kit.
