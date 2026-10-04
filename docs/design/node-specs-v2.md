# Spec chi tiết 5 node: Text · Image · Video · Audio · Sticky

> Nguồn tham khảo: [Lumina — 5 node trên canvas](../research/lumina/lumina-nodes-spec.md) và [Lumina — Image/Video standalone + AI Apps](../research/lumina-apps/lumina-apps-image-video-spec.md).
> Mọi định nghĩa bám theo contract hiện có: `contracts/types.ts` (`NodeType`, `Param`, `Port`, `TemplateMeta`) và `contracts/examples/registry/*.json`.
> Chỗ nào cần mở rộng contract đều được đánh dấu **[contract+]**.

---

## 0. Node có tái sử dụng cho nhiều mục tiêu không? Có, nếu giữ 4 nguyên tắc

Kiến trúc hiện tại đã tách **định nghĩa node** (registry JSON + worker) khỏi **giao diện** (form dùng chung, canvas React Flow). Vì vậy một node viết một lần có thể dùng ở nhiều nơi:

| Nơi dùng | Cách dùng lại cùng node |
|---|---|
| **Canvas** | Node có ports, nối dây, chạy theo DAG (hiện có) |
| **Template** | Hiện có. `meta.template.inputs = [{nodeId, paramKey}]` chọn ra các ô người dùng phải điền |
| **App / form** (như AI Apps của Lumina) | Cùng recipe, chỉ hiện các ô template dưới dạng form, kèm một đầu ra. Không cần node mới |
| **Trang tạo nhanh** (như trang Image/Video của Lumina) | Một recipe một node được tạo ngầm. Composer chính là panel của node |
| **Agent** | Dùng `agentHints` và schema params để tự dựng flow |
| **API** | Gửi recipe/params, nhận outputs |

Trong một node cũng có thể phục vụ nhiều mục tiêu bằng **mode** và **preset**, thay vì đẻ thêm node:

- `text.generate` có thể làm copy quảng cáo, viết kịch bản, làm giàu prompt, mô tả ảnh hay tóm tắt video. Mỗi mục tiêu chỉ là một preset system prompt.
- `image.generate` gom t2i, i2i, nhiều ảnh tham chiếu và sửa theo vùng (sau này) vào cùng một node, phân biệt bằng mode và cổng đầu vào.
- `video.generate` có các mode first/last frame, reference, edit và extend.
- `audio.generate` có các mode voice (TTS), music, sfx và voice-from-reference.

**Bốn nguyên tắc để node dùng lại được:**

1. **Thuần dữ liệu.** Node chỉ gồm params, ports và runner. Không đặt callback hay logic UI riêng trong định nghĩa (đúng như `docs/extending.md` đã quy định).
2. **Thông số đi theo model.** Đổi model thì form tự đổi. Không viết form riêng cho từng node hay từng model.
3. **Đầu ra kiểu chuẩn** (`text`, `image`, `list<image>`, `video`, `audio`), để node nào cũng nối được với nhau và với template/app.
4. **Không chứa ngữ cảnh "nơi dùng".** Node không biết mình đang chạy trên canvas, trong app hay qua agent.

**Khi nào nên tách thành node riêng?** Khi tập ports (đầu vào/ra) khác hẳn, hoặc khi cách chạy khác hẳn. Ví dụ `note.sticky` không chạy; `output.export` thì mux file. Còn nếu chỉ khác thông số thì dùng mode hoặc preset.

---

## 1. Phần chung cho 5 node

### 1.1 Mở rộng contract **[contract+]**

Đây là các thay đổi nhỏ nhất cần có. Tất cả tương thích ngược, registry `version` tăng lên 2 và có `migrate` cho từng node.

```ts
// 1) Danh mục model: file mới contracts/examples/models/*.json
export interface ModelSpec {
  key: string;                       // "seedream-5-pro"
  title: string;                     // "Seedream 5.0 Pro"
  kind: "llm" | "image" | "video" | "audio";
  description?: string;              // một dòng hiện trong picker
  modes: string[];                   // ["t2i","i2i"] | ["flf","r2v","edit","extend"] | ["tts","music"]
  accepts: Partial<Record<"text" | "image" | "video" | "audio", InputLimit>>;
  params: Record<string, Param>;     // thông số riêng của model (dùng lại kiểu Param hiện có)
  price: PriceRule;                  // dùng cho ước tính và hiện bảng giá
  badge?: string;                    // "Beta" | "Up to 74% off"
}
export interface InputLimit {
  max: number;                       // số lượng tối đa
  formats?: string[];                // ["png","jpg","webp"]
  maxBytes?: number;
  minDim?: number; maxDim?: number;  // px
  aspect?: [number, number];         // [0.4, 2.5]
  durationSec?: [number, number];    // video/audio
  totalDurationSec?: number;
}
export type PriceRule =
  | { unit: "credit_per_image"; base: number; byParam?: { key: string; map: Record<string, number> } }
  | { unit: "credit_per_second"; base: number; byParam?: { key: string; map: Record<string, number> } }
  | { unit: "credit_per_1k_tokens"; input: number; output: number }
  | { unit: "credit_per_1k_chars"; base: number };

// 2) Thêm kiểu Param mới
| { type: "model"; kind: ModelSpec["kind"]; default?: string }   // chọn model, lọc theo kind và mode
// thêm vào ParamCommon:
placement?: "inline" | "advanced" | "hidden";  // thay dần cho cờ `advanced`
modes?: string[];                              // param chỉ hiện ở các mode này

// 3) NodeType.cost.unit thêm "credit_per_1k_tokens"

// 4) RunContext.params nhận cả các param của model (merge theo model đang chọn)
```

**Cách form hiển thị:** param của node cộng với param của model đang chọn, lọc theo `mode`, rồi chia theo `placement`:
- `inline` → hiện thành chip ở chân panel
- `advanced` → nằm trong popover "Advanced"
- `hidden` → không hiện

Đổi model thì làm ba việc:
1. Giữ lại giá trị nào còn hợp lệ với model mới.
2. Bỏ những giá trị không còn hợp lệ.
3. Báo bằng toast, kiểu "Đã bỏ 2 thông số không hỗ trợ". Lumina giữ lại param rác; mình không làm vậy.

### 1.2 Khung node (UI chung)

| Phần | Spec |
|---|---|
| Header | Icon theo category, tên (double-click để đổi; lưu vào `label`), badge `⏱ 12.3s` sau khi chạy xong, chấm trạng thái |
| Thân | Theo trạng thái (§1.3). Placeholder vẽ đúng tỉ lệ đầu ra (ảnh/video) |
| Handle | Hiển thị một handle mỗi bên. Click thì mở palette đã lọc (đã có `PortPaletteContext`). Kéo ra chỗ trống thì mở palette tại điểm thả. Ports kiểu (typed) vẫn giữ trong data để validate |
| Panel prompt | Hiện dưới node khi được chọn: tab mode → chip đầu vào → ô prompt → chân panel `[model] [chip inline…] [Advanced] [1–4×] [≈ N credit] [Run/Stop]` |
| Chip đầu vào | Mỗi edge vào là một chip (icon + tên node nguồn). Bấm × thì `graph.disconnect` |
| Tool bar | Hiện trên node khi có kết quả: Download, Fullscreen, và các công cụ theo loại node (§3–§5) |
| Kích thước | Rộng 300. Có resize với min 300×120. Sticky có thể resize tự do |

### 1.3 Trạng thái (dùng `JobStatus` hiện có)

```
empty ──(nhập/nối)──> ready ──Run──> queued ──> running(progress) ──> done
                         ▲               │            │                 │
                         └──── Stop ─────┴────────────┘                 └──> failed (kèm Retry node, đã có)
```

- **empty:** hiện quick actions (§2.4, §3.4).
- **ready:** nếu thiếu input bắt buộc thì nút Run bị khoá, tooltip nói rõ thiếu gì.
- **queued / running:**
  - spinner và % trong thân node
  - viền node chạy hiệu ứng
  - pill toàn cục "Đang chạy n/m"
- **Stop** dùng được cho **mọi** node khi đang queued/running. Lumina không cho huỷ khi đang tạo ảnh.
- **done:** toast có thời gian chạy, kèm badge ⏱.

### 1.4 Lịch sử chạy trong node **[contract+ nhẹ]**

Mỗi node giữ danh sách các lần chạy: `{ runId, jobId, at, params snapshot, seed thực, outputs, credits }`.

- **Không ghi đè:** lần chạy mới chỉ chuyển "bản đang dùng" sang kết quả mới.
- **UI:** dải thumbnail hoặc nút ‹ › trên thân node. Menu của mỗi bản gồm *Dùng bản này*, *Re-edit* (đổ params cũ vào panel), *Chạy lại*, *Tạo node mới từ bản này*, *Xoá*.
- **Downstream:** các node phía sau dùng "bản đang dùng". Đổi bản thì đánh dấu downstream là `changed` (cờ này đã có trong store).
- **Lưu ở đâu:** lịch sử nằm phía server (runs/jobs đã có). Recipe chỉ lưu `params.activeOutput?: {jobId, index}`.

### 1.5 Credit

- Panel hiện `≈ N credit` tính từ `PriceRule` × thông số, nhân với `1–4×`.
- Hover vào thì hiện bảng giá theo model.
- Trước khi chạy, nếu tổng vượt một ngưỡng (ví dụ 50 credit) thì hỏi xác nhận.
- `estimateCredits` mở rộng để đọc `PriceRule`.

### 1.6 Tham chiếu trong prompt **[contract+]**

Thay vì lưu prompt là chuỗi thuần, lưu thành mảng đoạn:

```ts
type PromptPart = { text: string } | { ref: { edgeId: string; index?: number } } | { color: string };
params.prompt: PromptPart[]   // vẫn nhận string cho recipe v1 (migrate: string → [{text}])
```

- Gõ `@` thì hiện danh sách đầu vào đang nối (ảnh, text…) và mục "Màu…".
- Worker nhận prompt đã "dịch" sẵn thành text, cộng với bảng map `{ref → asset}`.

---

## 2. Text node: `text.generate` (mới) và `input.prompt` (giữ nguyên)

### 2.1 Mục tiêu dùng

Viết copy hay kịch bản, làm giàu prompt cho node ảnh/video, mô tả ảnh/video/audio, dịch, tóm tắt, sinh nhiều biến thể. `input.prompt` vẫn là node "chữ tĩnh", rẻ và không chạy.

### 2.2 Định nghĩa

```json
{
  "type": "text.generate", "version": 1, "title": "Text", "category": "text",
  "description": "Write or transform text with an LLM. Accepts text, images, video and audio as context.",
  "inputs": [
    { "key": "context", "kind": ["text", "image", "video", "audio"], "multiple": true, "label": "Context" }
  ],
  "outputs": [{ "key": "text", "kind": "text" }],
  "params": {
    "preset":   { "type": "enum", "options": [
                    { "value": "custom", "label": "Custom" },
                    { "value": "copy", "label": "Ad copy" },
                    { "value": "enrich", "label": "Enrich prompt" },
                    { "value": "describe", "label": "Describe media" },
                    { "value": "script", "label": "Script / storyboard" } ],
                  "default": "custom", "placement": "inline" },
    "prompt":   { "type": "string", "multiline": true, "required": true, "placeholder": "What should it write? Type @ to reference an input" },
    "model":    { "type": "model", "kind": "llm", "default": "seed-2.1-turbo", "placement": "inline" },
    "system":   { "type": "string", "multiline": true, "label": "System prompt", "placement": "advanced" },
    "useOwnText": { "type": "boolean", "default": true, "label": "Include this node's current text as context", "placement": "advanced" },
    "variants": { "type": "number", "min": 1, "max": 4, "step": 1, "default": 1, "label": "Variants", "placement": "advanced" }
  },
  "runner": { "kind": "job", "worker": "text-gen", "timeoutSec": 120, "concurrency": 8, "cacheable": true },
  "cost": { "unit": "credit_per_1k_tokens", "estimate": 0.5 },
  "ui": { "previewPort": "text" },
  "agentHints": "Use before image/video nodes to turn a short idea into a detailed prompt (preset enrich), or after media to describe it (preset describe)."
}
```

- Thông số theo model (lấy từ catalog `kind: "llm"`), ví dụ `maxTokens`, `thinking`, `temperature`, `topP`, `seed`, `reasoningEffort`.
- Model nào không nhận được kiểu đầu vào đang nối thì bị khoá trong picker, tooltip ghi "Model không đọc được video".

### 2.3 Hành vi

| Tình huống | Spec |
|---|---|
| Thân node | Textarea hiển thị kết quả hiện tại. **Sửa tay được** (double-click). Bản sửa tay được lưu thành một mục trong lịch sử, không bị mất |
| `useOwnText` | Bật thì chữ đang có trong node được gửi kèm làm ngữ cảnh ("viết lại đoạn này…"). Lumina không làm được điều này |
| `variants` > 1 | Đầu ra vẫn là `text`, mỗi biến thể là một mục trong lịch sử; người dùng chọn "bản đang dùng" |
| Preset | Đổi preset thì điền sẵn `system` (người dùng sửa được) và gợi ý placeholder. Preset là dữ liệu trong `contracts/examples/presets/text.json` |
| Tool bar | Copy · Download `.txt/.md` · Fullscreen (sửa, xem markdown) |
| Đầu ra | `{ value: string }`, đúng `Output` hiện có |

### 2.4 Quick actions khi node trống (template mini)

- **Write text:** chuyển thành `input.prompt` (đổi type) hoặc cho gõ thẳng.
- **Enrich prompt:** preset `enrich`. Nếu có node ảnh/video phía sau thì tự nối.
- **Describe an image:** preset `describe`, đồng thời tạo một `input.asset` phía trước và nối vào `context`.

### 2.5 Worker

`text-gen` đọc `ctx.inputs.context[]` và gửi đúng loại media cho model. Nó cần `ctx.models.generate("text", …)` **[contract+: thêm kind "text" vào ModelsClient]**. Worker trả về `{ text: { value } }` và báo tiến độ theo token stream (`ctx.report`).

### 2.6 Tiêu chí hoàn thành

- [ ] Nối 2 ảnh và 1 text vào Text, chạy được; ở chế độ mock, đầu ra có nhắc tới cả 3 đầu vào.
- [ ] Đổi sang model không đọc được ảnh thì model đó bị khoá trong picker và có lý do.
- [ ] Chạy 3 lần thì có 3 mục lịch sử; chọn bản 1 thì node phía sau được đánh dấu `changed`.
- [ ] Sửa tay rồi chạy lại vẫn giữ được bản sửa tay trong lịch sử.
- [ ] Recipe round-trip (to/from) giữ nguyên preset, system và prompt parts.

---

## 3. Image node: `image.generate` v2 (thay v1, có migrate)

### 3.1 Mục tiêu dùng

Tạo ảnh từ chữ, biến đổi ảnh (i2i), giữ nhân vật nhất quán bằng nhiều ảnh tham chiếu, tạo key visual cho video, sinh nhiều biến thể.

### 3.2 Định nghĩa

```json
{
  "type": "image.generate", "version": 2, "title": "Image", "category": "image",
  "description": "Make images from a prompt, optionally guided by reference images.",
  "inputs": [
    { "key": "prompt",     "kind": "text",  "required": false, "label": "Prompt text" },
    { "key": "references", "kind": "image", "multiple": true, "label": "References" }
  ],
  "outputs": [{ "key": "image", "kind": "list<image>" }],
  "params": {
    "prompt":  { "type": "string", "multiline": true, "placeholder": "Describe the image. Type @ to place a reference" },
    "model":   { "type": "model", "kind": "image", "default": "seedream-5-pro", "placement": "inline" },
    "size":    { "type": "json", "placement": "inline", "label": "Size",
                 "schema": { "oneOf": [
                   { "type": "object", "properties": { "ratio": { "type": "string" }, "area": { "enum": ["1k","2k","4k"] } } },
                   { "type": "object", "properties": { "width": { "type": "integer" }, "height": { "type": "integer" } } } ] } },
    "count":   { "type": "number", "min": 1, "max": 4, "step": 1, "default": 1, "placement": "inline", "label": "Images" },
    "seed":    { "type": "number", "placement": "advanced" }
  },
  "runner": { "kind": "job", "worker": "image-gen", "timeoutSec": 300, "concurrency": 4, "cacheable": true },
  "cost": { "unit": "credit_per_image", "estimate": 1 },
  "ui": { "previewPort": "image" },
  "migrate": "v1→v2: aspect → size.ratio; reference(port) → references[0]; prompt port unchanged",
  "agentHints": "First step of most visual flows. Connect several references to keep a character consistent."
}
```

- **Prompt:** cổng `prompt` (từ Text) và ô `prompt` của node được **nối với nhau** theo thứ tự: chữ từ cổng trước, chữ trong ô sau. Ô prompt có `@` để đặt tham chiếu.
- **Mode tự suy:** không có ảnh tham chiếu thì là `t2i`, có ảnh thì là `i2i`. Không cần chọn tay.
- **Thông số theo model:**
  - Seedream: `outputFormat`, `watermark`
  - GPT Image: `quality`
  - Nano Banana: `resolution`
  - Có thể thêm `camera` (preset máy quay, ống kính, tiêu cự, khẩu độ) dưới dạng `json` với `placement: "inline"` (P2)
- **Ràng buộc:** `accepts.image.max` của model, ví dụ 14. Nối quá số này thì lỗi `KIND`, message nói rõ giới hạn.

### 3.3 Widget Size

- Popover "Size" có ô tỉ lệ: 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9 và **Custom**.
- Có W×H kèm khoá tỉ lệ, **hoặc** chọn diện tích 1k/2k/4k. Hai cách loại trừ nhau, hiện cảnh báo rõ (Lumina chỉ ghi "scale will fail").
- Min/max lấy từ model.
- Placeholder trong thân node vẽ đúng tỉ lệ đang chọn.

### 3.4 Quick actions và tool bar

- **Quick actions khi trống:**
  - **Upload ảnh:** biến thành `input.asset`.
  - **Image-to-image:** tạo `input.asset` phía trước, nối vào `references`.
- **Tool bar khi có kết quả** (mỗi tool tạo **node mới** nối từ node gốc, không sửa đè):

| Tool | Cách làm |
|---|---|
| Download · Fullscreen (zoom, xoay) | Cục bộ |
| Crop | Cục bộ, cắt ngay trên node. Tạo `input.asset` mới chứa ảnh đã crop, nối bằng **edge lineage** **[contract+: `RecipeEdge.kind?: "data" \| "lineage"`]** |
| Upscale | Tạo node `image.edit` (mode upscale) mới, nối data edge, rồi chạy |
| Split lưới 2×2 / 3×3 | Cục bộ. Tạo N node `input.asset`, xếp lưới bên phải, nối edge lineage |
| Dùng làm tham chiếu video | Tạo `video.generate` mới, nối vào `frames.first` |

### 3.5 Đầu ra và lịch sử

- `count` = 4 thì một lần chạy ra 4 ảnh. Thân node hiện lưới 2×2; bấm một ảnh để chọn ảnh đang dùng (`activeOutput.index`).
- Node phía sau nhận cả list (`list<image>`), hoặc chỉ ảnh đang dùng nếu cổng không phải list. Cách này dùng lại quy tắc `multiplicity` sẵn có trong `estimate.ts`.

### 3.6 Tiêu chí hoàn thành

- [ ] Recipe v1 (aspect 9:16, reference) migrate sang v2 không mất dữ liệu; có test.
- [ ] Nối 3 ảnh vào `references` rồi gõ `@` thấy Ref1..Ref3; prompt lưu dạng parts.
- [ ] Đổi model sang loại tối đa 1 ảnh tham chiếu thì có issue rõ ràng và nút Run bị khoá.
- [ ] Upscale tạo node mới, không đụng vào ảnh gốc; một lần Undo xoá node đó.
- [ ] Ước tính credit đổi theo `count` × giá model × `1–4×`.

---

## 4. Video node: `video.generate` v2

### 4.1 Mục tiêu dùng

Ảnh thành video, khung đầu/cuối thành video, video từ nhiều tham chiếu (ảnh, video, audio), sửa video, nối dài video. Cùng một node phục vụ quảng cáo, storyboard hay clip nhạc.

### 4.2 Định nghĩa

```json
{
  "type": "video.generate", "version": 2, "title": "Video", "category": "video",
  "description": "Make a video from a prompt, frames or references. Long job.",
  "inputs": [
    { "key": "prompt",     "kind": "text",  "label": "Prompt text" },
    { "key": "firstFrame", "kind": "image", "label": "First frame" },
    { "key": "lastFrame",  "kind": "image", "label": "Last frame" },
    { "key": "references", "kind": ["image", "video", "audio"], "multiple": true, "label": "References" },
    { "key": "source",     "kind": "video", "label": "Video to edit / extend" }
  ],
  "outputs": [{ "key": "video", "kind": "video" }],
  "params": {
    "mode":       { "type": "enum", "options": [
                      { "value": "frames", "label": "First / last frame" },
                      { "value": "reference", "label": "Reference" },
                      { "value": "edit", "label": "Edit video" },
                      { "value": "extend", "label": "Extend video" } ],
                    "default": "reference", "placement": "inline" },
    "prompt":     { "type": "string", "multiline": true, "placeholder": "Describe the motion. Type @ to place a reference" },
    "model":      { "type": "model", "kind": "video", "default": "seedance-2", "placement": "inline" },
    "ratio":      { "type": "enum", "options": ["adaptive","16:9","9:16","1:1","4:3","3:4","21:9"], "default": "adaptive", "placement": "inline" },
    "resolution": { "type": "enum", "options": ["480p","720p","1080p"], "default": "720p", "placement": "inline" },
    "durationSec":{ "type": "number", "min": 4, "max": 15, "step": 1, "default": 5, "unit": "s", "placement": "inline", "modes": ["frames","reference","extend"] },
    "audio":      { "type": "boolean", "default": true, "label": "Generate sound", "placement": "advanced" },
    "seed":       { "type": "number", "placement": "advanced" }
  },
  "runner": { "kind": "job", "worker": "video-gen", "timeoutSec": 900, "concurrency": 2 },
  "cost": { "unit": "credit_per_second", "estimate": 2 },
  "ui": { "previewPort": "video" },
  "migrate": "v1→v2: image(port) → firstFrame; mode = frames"
}
```

### 4.3 Quy tắc mode (dữ liệu, không hard-code)

| Mode | Cổng dùng | Bắt buộc | Model cần hỗ trợ |
|---|---|---|---|
| `frames` | firstFrame, lastFrame? | firstFrame | `flf` |
| `reference` | references[] (ảnh/video/audio) | prompt hoặc ≥ 1 ref | `r2v` |
| `edit` | source | source | `edit` |
| `extend` | source | source | `extend` |

- **Tự chọn mode khi nối dây:** nối ảnh vào node trống thì chọn `frames`; nối video thì gợi ý `edit`/`extend`. Có toast báo và cho đổi lại.
- Tab mode nào model không hỗ trợ thì **khoá kèm tooltip lý do**, không ẩn đi.
- `durationSec`, `resolution` và `ratio` lấy min/max/options từ model. Khi đổi model, giá trị không còn hợp lệ được **tự kẹp về giá trị gần nhất và báo**, không để trống như Lumina.
- Ràng buộc từng loại tham chiếu đọc từ `accepts`: ví dụ ≤ 9 ảnh, ≤ 3 video tổng ≤ 15s, ≤ 3 audio. Vi phạm thì có issue chỉ rõ cổng và giới hạn.

### 4.4 Hiển thị và tool bar

- **Thân node:** chờ thì hiện "Đang xếp hàng", chạy thì hiện %.
- **Xong:** video tự phát, tắt tiếng, có đồng hồ `00:02/00:05` và nút loa. Khi canvas zoom dưới 50% thì chỉ hiện poster để nhẹ máy.
- **Tool bar:**
  - Download, Fullscreen (player đầy đủ).
  - **Lấy khung hình:** chọn đầu, cuối hoặc thời điểm hiện tại → tạo `input.asset` ảnh, nối edge lineage.
  - **Trim:** cục bộ → tạo `input.asset` video mới.
  - **Tách âm thanh:** tạo node `audio` asset, nối edge lineage.
  - **Dùng khung cuối làm khung đầu của video tiếp theo:** tạo `video.generate` mới, mode `frames`. Đây là cách nối shot.

### 4.5 Tiêu chí hoàn thành

- [ ] Recipe v1 (image→video) migrate thành `mode=frames`, `firstFrame`.
- [ ] Nối một ảnh vào node trống thì mode tự thành `frames`; nối video thì tab `edit`/`extend` mở khoá (nếu model hỗ trợ).
- [ ] Đổi sang model có duration tối đa 10s khi đang đặt 15s thì giá trị bị kẹp về 10, có toast, và ước tính credit cập nhật.
- [ ] Nối 4 ảnh vào model chỉ nhận tối đa 3 thì có issue `INPUT_LIMIT` **[contract+ IssueCode]** chỉ đúng cổng.
- [ ] Bấm Stop khi đang queued/running thì job thành `cancelled` và downstream thành `skipped`.
- [ ] Lấy khung cuối tạo được node asset mới với edge lineage; run planner bỏ qua edge lineage.

---

## 5. Audio node: `audio.generate` v2

### 5.1 Mục tiêu dùng

Lồng tiếng / TTS cho video, nhạc nền, hiệu ứng âm thanh, giọng theo mẫu (audio tham chiếu), âm thanh khớp ảnh/video.

### 5.2 Định nghĩa

```json
{
  "type": "audio.generate", "version": 2, "title": "Audio", "category": "audio",
  "description": "Speech, music or sound effects from text, optionally guided by audio, image or video.",
  "inputs": [
    { "key": "text",       "kind": "text",  "label": "Script / description" },
    { "key": "references", "kind": ["audio", "image", "video"], "multiple": true, "label": "References" }
  ],
  "outputs": [{ "key": "audio", "kind": "audio" }],
  "params": {
    "mode":   { "type": "enum", "options": [
                  { "value": "voice", "label": "Voice" },
                  { "value": "music", "label": "Music" },
                  { "value": "sfx",   "label": "Sound effect" } ],
                "default": "voice", "placement": "inline" },
    "text":   { "type": "string", "multiline": true, "placeholder": "What should it say or sound like?" },
    "model":  { "type": "model", "kind": "audio", "default": "seed-tts", "placement": "inline" },
    "voice":  { "type": "json", "label": "Voice", "placement": "inline", "modes": ["voice"],
                "schema": { "type": "object", "properties": { "id": { "type": "string" }, "name": { "type": "string" } } } },
    "speed":  { "type": "number", "min": 0.5, "max": 2, "step": 0.05, "default": 1, "placement": "advanced", "modes": ["voice"] },
    "pitch":  { "type": "number", "min": -12, "max": 12, "step": 1, "default": 0, "placement": "advanced", "modes": ["voice"] },
    "volume": { "type": "number", "min": 0.5, "max": 2, "step": 0.05, "default": 1, "placement": "advanced" },
    "style":  { "type": "string", "label": "Style (e.g. extremely happy)", "placement": "advanced", "modes": ["voice"] },
    "durationSec": { "type": "number", "min": 3, "max": 120, "step": 1, "default": 15, "unit": "s", "placement": "inline", "modes": ["music","sfx"] },
    "format": { "type": "enum", "options": ["mp3","wav"], "default": "mp3", "placement": "advanced" }
  },
  "runner": { "kind": "job", "worker": "audio-gen", "timeoutSec": 300, "concurrency": 4, "cacheable": true },
  "cost": { "unit": "credit_per_1k_chars", "estimate": 0.5 },
  "ui": { "previewPort": "audio" },
  "migrate": "v1→v2: voice(enum) → voice{id,name}; mode voice/music unchanged"
}
```

### 5.3 Hành vi

| Phần | Spec |
|---|---|
| Thư viện giọng | Chip "Voice: Daisy" mở popover: lọc giới tính, tuổi, cảnh dùng (quảng cáo, đọc truyện, thuyết minh…) và ngôn ngữ; ô tìm kiếm; thẻ có ▶ nghe thử (file mẫu tĩnh, không tốn credit). Danh sách giọng là dữ liệu `contracts/examples/voices.json` |
| Tự đổi model | Đầu vào đang nối mà model không nhận được thì tự đổi sang model nhận được, kèm **toast giải thích** và nút Hoàn tác |
| Cách tính giá | `voice` tính theo ký tự; `music`/`sfx` tính theo giây (`PriceRule` theo mode) |
| Thân node | Waveform, ▶, scrubber, `00:00/00:05`. Không lộ key thô ("url") như Lumina |
| Tool bar | Download, **Trim** (thanh cắt có phím tắt: ←/→ di chuyển, I/O đặt điểm vào/ra, Space phát, Enter xác nhận) tạo `input.asset` mới |

### 5.4 Tiêu chí hoàn thành

- [ ] `mode=voice` hiện voice/speed/pitch/style; `mode=music` hiện duration. Param của mode kia không bị lưu vào recipe.
- [ ] Nối ảnh vào node đang dùng model chỉ TTS thì model tự đổi, có toast và Undo.
- [ ] Nghe thử giọng không tạo job và không trừ credit.
- [ ] Ước tính credit cho `voice` đổi theo độ dài chữ (cổng `text` lấy giá trị upstream nếu đã có).
- [ ] Trim tạo asset mới; asset gốc không đổi.

---

## 6. Sticky note: `note.sticky` (mới)

### 6.1 Mục tiêu dùng

Ghi chú, brief, checklist, hướng dẫn trong template (giải thích cho người dùng template cần điền gì), và chú thích cho một nhóm node.

### 6.2 Định nghĩa

```json
{
  "type": "note.sticky", "version": 1, "title": "Sticky note", "category": "input",
  "description": "A Markdown note on the canvas. Never runs.",
  "inputs": [], "outputs": [],
  "params": {
    "text":  { "type": "string", "multiline": true, "placeholder": "Write a note… Markdown supported" },
    "color": { "type": "enum", "options": ["yellow","pink","blue","green","purple","gray"], "default": "yellow" }
  },
  "runner": { "kind": "flow" },
  "cost": { "unit": "credit_per_run", "estimate": 0 },
  "ui": { "body": "sticky", "width": 280 }
}
```

**[contract+]** `runner.kind` thêm `"none"`, hoặc đánh dấu bằng `ui.body: "sticky"`. Cả validator, planner và estimate đều **bỏ qua** node này: nó không tạo issue, không tạo job và không tính credit.

### 6.3 Hành vi

| Phần | Spec |
|---|---|
| Hiển thị | Thẻ giấy có góc gập, màu theo `color`. Markdown (GFM) render ngay trên canvas; nội dung dài thì cuộn trong thẻ (`nowheel`) |
| Sửa | Double-click mở editor (split: Edit · Preview), có full-screen. Esc hoặc bấm ra ngoài thì lưu. Checkbox trong task list **bấm được** trên canvas và cập nhật vào markdown |
| Lớp | Luôn nằm trên các node khác (zIndex cao), nhưng dưới panel và menu |
| Resize | Tự do, min 160×100 |
| Chú thích node | Tuỳ chọn. Kéo từ góc sticky tới một node để tạo **edge `kind: "annotation"`** (nét đứt, không truyền dữ liệu). Di chuyển node thì sticky giữ liên kết. Khác Lumina: không giả làm dây dữ liệu |
| Template | Sticky trong template hiện như "hướng dẫn" khi người dùng điền ô |
| Tool bar | Màu · Copy markdown · Download `.md` · Fullscreen |

### 6.4 Tiêu chí hoàn thành

- [ ] Canvas có sticky: `validate()` không thêm issue, Run không tạo job, estimate bằng 0.
- [ ] Markdown (heading, bold, list, task list, code, table) render đúng; checkbox bấm được và lưu lại.
- [ ] Undo/redo khi sửa và đổi màu hoạt động; đồng bộ được hai tab (Yjs).
- [ ] Edge annotation không xuất hiện trong run planner và không chặn xoá node.

---

## 7. Kế hoạch triển khai

| Giai đoạn | Việc | Phụ thuộc |
|---|---|---|
| **P0-a** | [contract+] `ModelSpec` + catalog JSON, `type:"model"`, `placement`, `modes`, `credit_per_1k_tokens`, `IssueCode INPUT_LIMIT`, `edge.kind`, `runner none` · migrate v1→v2 · test validator | — |
| **P0-b** | Panel prompt dùng chung (thay `ParamForm` inline trong `web/src/BaseNode.tsx`): tab mode, chip đầu vào gắn với edge, chân panel theo placement, ước tính credit, Run/Stop | P0-a |
| **P0-c** | `note.sticky` và `text.generate` (mock worker) | P0-a/b |
| **P0-d** | `image.generate` v2 (size widget, nhiều ảnh tham chiếu, count + chọn ảnh đang dùng) | P0-b |
| **P1-a** | Lịch sử chạy trong node + `activeOutput` + Re-edit | runs API |
| **P1-b** | `video.generate` v2 (mode, ràng buộc tham chiếu, kẹp giá trị khi đổi model) | P0-a/b |
| **P1-c** | `audio.generate` v2 (mode, thư viện giọng, auto-switch model) | P0-a/b |
| **P1-d** | Prompt parts + `@` tham chiếu + token màu | P0-b |
| **P1-e** | Tool bar: crop, split, upscale, lấy khung hình, trim, tách âm thanh (tạo node mới + edge lineage) | P0-a |
| **P2** | Camera preset, region (Artboard), timeline nhiều shot cho video, "Publish template thành app" | P1 |

## 8. Câu hỏi mở (cần bạn chốt)

1. **Text:** gộp `input.prompt` vào `text.generate` (một node, hai chế độ), hay giữ hai node riêng? Mình đề xuất **giữ riêng** cho đơn giản; quick action "Write text" chuyển qua lại giữa hai node.
2. **Lịch sử chạy:** lưu bao nhiêu bản mỗi node? Đề xuất 20 bản, cũ hơn thì chỉ còn trong Media browser.
3. **Ngưỡng xác nhận credit:** đề xuất 50; có cần theo space không?
4. Danh sách model thật cho mock: dùng tên giả trung tính hay tên thật (Seedream/Seedance…)?
