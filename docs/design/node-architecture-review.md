# Review cách xây node trên canvas và đề xuất hướng chốt

Ngày 2026-10-04. Đọc trên branch `feat/node-prototype`: `contracts/`, `graph/`, `web/src/{BaseNode,Params,Canvas,store,connections}.tsx|ts`, `web/src/kit/`, `web/src/prototype/`, [node-specs-v2.md](node-specs-v2.md), [node-ui-kit.md](node-ui-kit.md), [node-prototype-summary.md](node-prototype-summary.md), [lumina-nodes-spec.md §11](../research/lumina/lumina-nodes-spec.md).

## 1. Kết luận ngắn

| | Đánh giá |
|---|---|
| **Hướng kiến trúc** (kit controlled + `GenSource` adapter + model là dữ liệu) | Đúng. Giữ. |
| **Prototype về UX** | Đủ để chốt bố cục và hành vi của 5 node. Không cần làm thêm UI trước khi ghép. |
| **Prototype về code** | Là một thế giới song song: kiểu dữ liệu riêng (`NodeSpec/ModelSpec/FieldSpec`), store riêng thay `Graph`, validate/estimate riêng thay `graph.validate()` và `contracts/estimate.ts`. Nếu ghép thẳng thì phải viết lại ~60%. |
| **Việc cần làm tiếp** | Không phải thêm tính năng. Là **hợp nhất hợp đồng dữ liệu** rồi viết một adapter cho canvas thật. UI kit gần như giữ nguyên. |

Nói cách khác: 70% bạn cảm nhận là 70% **UX**; phần còn thiếu nằm ở lớp dữ liệu và tích hợp, không nằm ở màn hình.

## 2. Hiện trạng: ba lớp đang lệch nhau

```
contracts (sản phẩm)        prototype (kit + proto)             Lumina (tham chiếu)
NodeType {inputs: Port[],   NodeSpec {accepts: MediaKind[],     node + schema[] theo model,
  params: Param, cost}        fields: FieldSpec[], modes}         capabilities, placement
Param.type = kiểu dữ liệu   FieldSpec.type = kiểu dữ liệu       format = widget
  (enum/number/json…)         + widget (size/duration/voice/camera)
model = enum trong params   ModelSpec {fields, price, accepts}  model catalogue riêng
Graph (Yjs) + runs/jobs     useProto store + setTimeout         —
graph.validate() → Issue[]  kit/logic.validate → string[]       —
contracts/estimate.ts       kit/logic.estimate                  billing table
RecipeEdge (có port)        edge {dashed?} không port           edge + virtual edge
input.asset (node riêng)    asset: true (cờ trên node gen)      BAFileLoad (node riêng)
```

Những chỗ lệch này không phải lỗi của prototype (nó cố ý không đụng contracts), nhưng là chỗ phải quyết trước khi viết code sản phẩm.

## 3. Bảy vấn đề cần chốt (xếp theo mức ảnh hưởng)

### 3.1 Hai hệ kiểu dữ liệu → giữ `Param`, thêm gợi ý UI

`FieldSpec` trộn kiểu dữ liệu với widget (`type: "size" | "duration" | "voice" | "camera"`). Contracts đã có `Param` là kiểu dữ liệu thuần, có `json` kèm schema. Đề xuất:

```ts
// contracts/types.ts — chỉ thêm, không đổi
interface ParamCommon {
  …
  ui?: {
    placement?: "inline" | "advanced" | "more" | "hidden"; // thay dần cờ `advanced`
    widget?: "tiles" | "segment" | "slider" | "chip" | "size" | "duration" | "voice" | "camera";
    group?: string;        // chip gộp (ratio + resolution)
    icon?: "panorama" | "size";
    modes?: string[];      // chỉ hiện ở các mode này
    requiredHint?: string; // "Please modify the duration."
  };
}
```

Kit render theo `param.type` + `param.ui.widget`. `FieldSpec` biến mất; `resolveFields` nhận `Param`. Đây là đúng tinh thần `docs/extending.md`: node mới chỉ cần JSON.

### 3.2 Danh mục model là hợp đồng còn thiếu → `contracts/models/*.json` + `/models`

Prototype đã chứng minh được *hình dạng* đúng: `modes`, `accepts {kind: {max}}`, `params`, `price`, `requires`, `hidden`, `cancel`, `billing`, `vendor`. Cần biến nó thành dữ liệu sản phẩm:

- `contracts/models/<kind>/<key>.json`, có JSON schema trong `contracts/schemas/model.schema.json`.
- Server phục vụ `GET /models` (như `/registry` hiện nay) và dùng cùng file để map `effort → knob của nhà cung cấp`, tính credit thật. Vì "cấu hình đổi mỗi ngày", **catalog phải fetch lúc chạy**, không compile vào web.
- Registry node tham chiếu bằng kiểu param mới: `"model": { "type": "model", "kind": "image", "default": "seedream-5-pro" }`.
- `PriceRule` cần nói rõ **key nào đếm đơn vị** (`unitsFrom: "count"` / `"durationSec"`), thay vì `estimate()` đang hard-code `count`, `group`, `maxImages`, `duration`.
- `aspectOf()` đang dò 6 cách đặt tên khác nhau. Model nên khai báo `ui.aspectFrom: "size"` (hoặc `"ratio"`).

Khi đó `catalog.ts` (838 dòng TS) trở thành thư mục JSON, và `generate.ts` giả lập được thay bằng `MOCK_WORKERS=1` sẵn có.

### 3.3 Mất port có kiểu → giữ port trong recipe, UI một handle, chip hiện vai trò

Prototype gộp mọi đầu vào thành một danh sách phẳng (`inputsOf`), nên **không phân biệt được ảnh nào là first frame / last frame, video nào là nguồn sửa hay chỉ là tham chiếu**. Spec v2 §1.2 đã nói đúng: *port có kiểu giữ trong data, hiển thị một handle mỗi bên*. Đề xuất cụ thể:

- Recipe giữ `targetPort`. Khi nối, `resolveInput()` (đã có trong `connections.ts`) tự chọn port hợp lệ đầu tiên.
- Chip trong `RefTray` hiện vai trò (`First frame`, `Reference 2`, `Source`), bấm vào thì đổi port trong số port cùng kind. Đây là thứ Lumina không có và cũng là lý do Lumina phải nhờ `@` trong prompt để phân vai.
- Mode gợi ý (`suggestMode`) hiện hard-code `node.type === "video"`; chuyển thành dữ liệu trên `ModeSpec` (`needs`, `prefer`).

### 3.4 Hai dạng node → `*.generate` và `input.asset`, không dùng cờ `asset: true`

Quyết định "Gen / media thường" ánh xạ sạch sang hai type đã có. Lumina cũng tách (`BALLMImage` vs `BAFileLoad`). Lợi ích: `input.asset` đã có Media browser, `acceptedMediaKinds`, kiểm tra file bị xoá. Việc cần thêm:

- Upload trong node Gen = một `graph.transaction`: tạo `input.asset` cùng vị trí, chuyển các edge ra, xoá node gen. Edge vào bị bỏ (media không nhận input) đúng như prototype.
- `BaseNode` render `input.asset` bằng **cùng shell media** (header icon file, toolbar, không Composer), để ảnh tải lên và ảnh sinh ra trông giống nhau.

### 3.5 Tool là dữ liệu; kết quả cục bộ là asset mới + edge lineage

Prototype dùng `derive()` + "tool model" ẩn (`image-tool`, `vod-enhance`). Tốt về UX, nhưng cần:

- `ToolSpec { id, label, icon, appliesTo: Kind[], kind: "local" | "derive", derive?: { type, params } }` nằm trong registry (`ui.tools`) hoặc file extension. Thêm tool = JSON + worker.
- `RecipeEdge.kind?: "data" | "lineage" | "annotation"` **[contract+]**. Validator, planner, estimate bỏ qua edge không phải `data`. Prototype mới có `dashed` trên UI.
- Tool cục bộ (crop, trim, frame capture, split) tạo blob ở client → `uploadAsset()` (đã có) → `input.asset` mới nối lineage. Crop "tại chỗ" của prototype thực ra là tạo một mục lịch sử mới; với asset server thì hành vi tương đương là **thay asset đang dùng** của node và vẫn giữ bản cũ trong lịch sử.
- **Chỉ hiện tool có worker thật.** Hiện prototype có 11 nút chỉ toast "chưa có" (Draw, Multi-Angle, 720°, Storyboard, Lighting, Erase, A/V Separation, Video Editor…). Trong sản phẩm, bỏ khỏi toolbar cho tới khi có worker; đừng đoán hành vi.

### 3.6 Lịch sử chạy trên node → cần API, không chỉ UI

Prototype giữ `history[]` trong store. Sản phẩm đã có runs/jobs phía server, nên:

- `GET /canvases/:id/history?nodeId=` trả các job đã `done` của node đó qua các run (giới hạn 20).
- Recipe chỉ lưu `params.activeOutput: { jobId, index }`. Node phía sau đọc bản đang dùng; đổi bản → cờ `changed` (đã có).
- Sửa tay Text và crop tại chỗ cũng là một mục lịch sử (prototype đã làm đúng ý này).

### 3.7 Tham chiếu `@` trong prompt theo **nhãn** là mong manh

`Composer` lưu `"@Image 1"` dạng chữ thuần; đổi tên node hoặc đổi thứ tự dây là mất liên kết. Chốt một trong hai (tôi đề xuất cách 1 vì tương thích ngược và recipe vẫn là chuỗi):

1. Token trong chuỗi: `@{edge:e_12}`, `@{color:#46a758}`. Editor hiển thị nhãn, worker dịch ra text + map `{edgeId → asset}`.
2. `PromptPart[]` như spec v2 §1.6, migrate `string → [{text}]`.

## 4. Những điểm nhỏ nhưng sẽ gây đau khi ghép

| Chỗ | Vấn đề | Sửa khi viết adapter |
|---|---|---|
| `adapter.ts` `useGenSource` | Subscribe toàn bộ `nodes` và `edges` → mọi node re-render khi bất kỳ node nào đổi. Canvas thật từng phải tối ưu drag (`6208b9b`). | Chỉ select node này + edge vào nó; memo theo `revision`. |
| `nodes.tsx` `TRY` | Quick action hard-code theo type. | `ui.quickActions` trong registry. |
| `kit/logic.validate` trả `string[]` | Không có `code`, `paramKey`; không gắn được vào UI theo field. | Kit nhận `Issue[]` từ `graph.validate()`; thêm `INPUT_LIMIT`, `MODEL_INPUT`, `MODE_NEEDS` vào `IssueCode`. |
| `kit.css` | 114 chỗ `var(--…)` nhưng không có khối khai báo token riêng. | Tạo `kit-tokens.css` (sáng/tối) để đổi theme là đổi một file. |
| `store.run` `confirm()` ở 200 credit | Dùng dialog trình duyệt. | Dùng modal của app; ngưỡng lấy từ space. |
| Image "Generating, cannot cancel" | Bám Lumina, nhưng `RunContext.signal` của mình huỷ được mọi job. Audit §4 F lại ghi "cho huỷ". Hai doc đang mâu thuẫn. | Cho **Stop với mọi node**, ghi rõ "credit có thể vẫn bị tính" khi nhà cung cấp đã nhận request. |

Điểm tốt cần giữ nguyên: `web/src/kit/**` **không import** `@xyflow`, `store.ts`, `context.ts` (đã kiểm tra). Thêm lint rule để giữ như vậy.

## 5. Hướng tiếp cận đề xuất

**Nguyên tắc:** hợp đồng dữ liệu một nơi (`contracts/`), UI một nơi (`kit/`), mỗi nơi dùng chỉ viết adapter. Prototype trở thành **playground** chạy bằng mock adapter, không phải nhánh code riêng.

```
contracts/            registry JSON (+ui, +tools, +quickActions) · models JSON · form.ts (resolve/clamp/issues/estimate, có test)
web/src/kit/          Composer · fields · results · Lightbox · markdown  — chỉ props, kiểu từ contracts
web/src/canvas/       NodeChrome (header, handle, +, toolbar) · useCanvasGenSource(graph, runs) · tool runner (derive/local)
web/src/playground/   prototype.html hiện tại, dùng mockGenSource — để duyệt UX, không có store riêng
```

### Thứ tự làm (mỗi bước đều chạy được và e2e cũ vẫn xanh)

| Bước | Việc | Kết quả kiểm được |
|---|---|---|
| **1. Contracts** | `Param.ui`, `type: "model"`, `contracts/models/*.json` + schema, `RecipeEdge.kind`, `IssueCode` mới, `text.generate` v1, `note.sticky` v1, `image/video/audio.generate` v2 + `migrate`. Chuyển `kit/logic.ts` → `contracts/form.ts`, viết Vitest trước. | `pnpm test` xanh; recipe v1 round-trip. |
| **2. Server** | `GET /models`; runner merge params model; planner bỏ qua edge không `data`; `/history`. | Mock worker chạy với `image.generate` v2. |
| **3. Adapter canvas** | `useCanvasGenSource(nodeId)` trên `Graph` + `useRun`. Đổi `BaseNode` sang shell kit **sau cờ** `?nodes=v2`. Bắt đầu bằng **Image** (nhiều pattern nhất). | Cùng `Composer` chạy trên canvas thật và playground. |
| **4. Text + Sticky** | Ít rủi ro, không có tool. | — |
| **5. Video, Audio** | Mode/port theo 3.3; voice library từ `/models`. | — |
| **6. Tools** | Crop, Enhance (`image.edit`), Split, Frame capture, Trim, Extract audio. Chỉ những cái có worker. | Mỗi tool tạo asset/node thật, có lineage. |
| **7. Dọn** | Xoá `prototype/store.ts`, `generate.ts`, `catalog.ts`; giữ `prototype.html` làm playground. Bật cờ mặc định, bỏ `ParamForm` inline. | Không còn hai đường render node. |

### Những gì **không** nên làm lúc này

- Không thêm tool hay cấu hình model mới vào prototype. UI đã đủ để chốt.
- Không ghép prototype store vào canvas "tạm thời". Hai nguồn sự thật song song sẽ không bao giờ gỡ được.
- Không làm trang Gen, multi-select bar, Video Editor trước bước 3. Chúng chỉ rẻ khi adapter đã có.

## 6. Quyết định cần bạn chốt

1. **Port có kiểu** (3.3): giữ port trong recipe + chip vai trò, hay theo Lumina gom phẳng? Tôi đề xuất **giữ port**.
2. **Media node** (3.4): dùng `input.asset`, hay cờ `asset` trên node gen? Tôi đề xuất **`input.asset`**.
3. **Tham chiếu `@`** (3.7): token trong chuỗi hay `PromptPart[]`? Tôi đề xuất **token trong chuỗi**.
4. **Huỷ khi tạo ảnh**: cho Stop mọi node (khác Lumina) — đề xuất **cho**.
5. **Tool chưa có worker**: ẩn khỏi toolbar — đề xuất **ẩn**.
6. **Lịch sử trên node**: giữ (cần API ở bước 2) — đề xuất **giữ**, giới hạn 20.
7. `input.prompt`: giữ song song với `text.generate` (ẩn khỏi palette) hay migrate luôn? Đề xuất **giữ, ẩn**.
8. Theme: giữ sáng, nhưng làm `kit-tokens.css` ngay ở bước 3 để khỏi phải sửa lại.

Các mục trong [node-prototype-summary.md §7](node-prototype-summary.md) còn lại (bố cục không đè, menu tự đóng, Undo khi đổi model, tên mode dịch lại, `useOwnText`, Text chỉ còn Model/Effort/System) tôi đều đề xuất **giữ**; không cần bàn thêm.
