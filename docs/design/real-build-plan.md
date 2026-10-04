# Làm thật: model thật, `@` thật, Studio và asset

Trạng thái: **plan, chưa làm**. Thay prototype ([node-prototype-summary.md](node-prototype-summary.md), Studio trong `web/prototype.html#studio`) bằng app thật. Prototype vẫn là bản thiết kế để đối chiếu; app thật không import gì từ `web/src/prototype`.

## 1. Đã chốt (2026-10-04)

| # | Quyết định | Ghi chú |
| --- | --- | --- |
| D1 | **Hai adapter:** BytePlus cho ảnh, video, giọng; **Vercel AI SDK** cho LLM và vòng lặp agent | BytePlus **không có SDK Node chính thức** (chỉ Python, Go, Java). Adapter BytePlus = client REST mỏng tự viết. LLM của ModelArk tương thích OpenAI nên đi qua AI SDK. Cả hai nằm sau `ModelsClient` |
| D2 | **`@` phải link thật** tới asset, file upload hoặc node | Lưu theo id, không theo tên. Upload thành asset trước rồi mới được tham chiếu |
| D3 | Đưa kit (Composer, chip vai trò, `@`, feed) vào app thật | Kit vẫn không import xyflow hay store |
| D4 | Trang generate tên **Studio** | "Space" đã là không gian sở hữu asset (Personal / team) |
| D5 | **Lưu hết, thư viện chỉ hiện cái được giữ** | Mọi output vẫn thành asset (lịch sử, lineage). Media browser mặc định chỉ hiện asset `kept`. Upload luôn `kept` |

Đã chốt trước đó và vẫn áp dụng: model Auto mặc định, mode tab tường minh, preset cho Text, vai trò trên chip đầu vào, không billing trên UI, không seed, History chỉ có media ([node-flow-interaction.md](node-flow-interaction.md) §4).

## 2. App thật đang có gì

| Mảng | Hiện có | Thiếu so với thiết kế |
| --- | --- | --- |
| Node types | Registry JSON (`contracts/examples/registry/*.json`): `input.prompt`, `input.asset`, `image.generate`, `image.edit`, `video.generate`, `audio.generate`, `flow.if`, `output.export`. Port có `kind`, param có `showIf` | **Không có node Text / LLM.** Param theo model (catalog) chưa có; `image.generate` còn param `seed` |
| Run | `POST /runs` chạy **cả recipe**; pg-boss `canvas-run`; worker `generated()` gọi `ctx.models.generate` rồi `ctx.putAsset`; tiến độ qua `run_events` + WebSocket | Không có chạy một node. Retry **xoá job cũ** của node. Không có lịch sử theo node |
| Model | `server/src/models.ts` chỉ có mock; tắt mock thì báo "Real model providers are not configured" | Toàn bộ provider |
| Tham chiếu | Edge port→port; `input.asset` giữ id asset; upload qua `POST /assets` | Không có `@` nào ở server, contracts hay web |
| Asset | Output tự thành asset `generated` có `generation` (prompt, model, settings, references); media browser có lọc Uploaded/Generated | Không có cờ `kept` |
| Web | Canvas đồng bộ Yjs (Hocuspocus); `BaseNode` + `ParamForm`; chọn run trong "Run history" | Kit chưa dùng ở app thật |

## 3. Contract cần chốt trước khi code (P0)

1. **Catalog model** phía server: `GET /models` trả `ModelSpec` (id, kind, fields, accepts, cancel). Kit vẽ tham số từ đây. Node chỉ giữ `model` (hoặc `auto`), `mode`, `prompt` và `params` của model. Xem lại phần "hai hệ type" trong [node-architecture-review.md](node-architecture-review.md).
2. **Prompt có tham chiếu.** Param `prompt` là chuỗi có token, ví dụ `@[Logo](asset:ast_123)` và `@[Key visual](node:n_abc)`. Tên chỉ để hiển thị; đổi tên node hay asset không làm hỏng link. Runner đổi token thành danh sách tham chiếu có thứ tự và viết lại theo quy ước của model (ví dụ "image 1").
   - `node:` phải có edge thật tới node đó. Gõ `@` chọn một node chưa nối thì **tự tạo edge** (kèm vai trò), để canvas luôn thể hiện đúng flow.
   - `asset:` trên canvas: tạo node `input.asset` và edge, để thấy được trên canvas. Trong Studio không có canvas nên lưu thẳng id asset.
   - Upload: tải lên thành asset trước (`POST /assets`), rồi thành `asset:`.
   - Tham chiếu hỏng (asset đã xoá, node đã xoá) là lỗi kiểm tra trước khi chạy, giống `INPUT_REQUIRED`.
3. **Vai trò trên edge.** `RecipeEdge.targetPort` mang vai trò (`first`, `last`, `source`, `reference`, `voice`…), khớp `RoleSpec` của kit.
4. **Node `text.generate`.** Input `context` (nhiều, mọi kind), param `preset`, `system`, `model`, `effort`, `useOwnText` (chỉ trên canvas).
5. **Asset `kept`.** Cột `assets.kept boolean`, upload = `true`, generated = `false`. `GET /assets` mặc định `kept=true`, có `kept=all`. `POST /assets/:id/keep` và `/unkeep`. Kéo một kết quả vào canvas, tải xuống hoặc dùng làm tham chiếu thì tự `keep`.
6. **Lịch sử theo node.** `GET /canvases/:id/nodes/:nodeId/history`: các lần chạy của node qua mọi run (job + output + snapshot giá trị). Retry **không xoá** job cũ nữa mà đánh dấu thay thế.
7. **Chạy một node.** `POST /runs` nhận `target: nodeId`: chạy node đó và phần phía trên còn thiếu (dùng `output_cache`). Chi tiết ngữ nghĩa Run vẫn là scope riêng của bạn; đây chỉ là mức tối thiểu để Composer và Studio chạy được.
8. **Bỏ seed** khỏi registry (`image.generate`). `GenerationProvider.seed` vẫn giữ nếu nhà cung cấp trả về, vì đó là dữ liệu lineage, không hiện trên UI.

## 4. Các bước

| Bước | Nội dung | Xong khi |
| --- | --- | --- |
| **P0 · Contract** | Mục 3, kèm test contract và migration (`kept`, lịch sử job) | `pnpm test` xanh; registry và schema mới được validate |
| **P1 · Adapter BytePlus** | Client REST: Seedream (tạo + sửa ảnh), Seedance (tạo task, hỏi trạng thái, huỷ), TTS. Config `ARK_API_KEY`, `ARK_BASE_URL`, map model. `signal` huỷ task thật. Lỗi nhà cung cấp thành lỗi job dễ đọc. Ghi `usage` (cho hạn ngạch sau này) | Chạy được ảnh, video, giọng thật với `MOCK_WORKERS=0`; mock vẫn chạy cho test và e2e |
| **P2 · AI SDK** | Provider OpenAI-compatible trỏ vào ModelArk; worker `text.generate` (đọc ảnh, video, audio làm context nếu model hỗ trợ); Auto chọn model | Node Text chạy thật; đổi provider chỉ là đổi config |
| **P3 · Vòng lặp chất lượng (bản đầu)** | Mỗi run là một vòng lặp do runner điều khiển, trạng thái lưu trong job sau mỗi bước: viết lại prompt → sinh → (tuỳ chọn) chấm bằng model nhìn được → thử lại. Có trần số lần và thời gian. Lưu **công thức cuối** (prompt cuối, model, tham số) vào `generation` | Run lưu được ý định gốc và công thức cuối; huỷ giữa vòng lặp giữ bản tốt nhất |
| **P4 · Kit vào canvas thật** | Node generate dùng Composer của kit qua một `GenSource` đọc Graph (Yjs) và API thật; `@` autocomplete lấy từ edge, asset và upload thật; chip vai trò ghi lên edge; lịch sử node từ endpoint mục 3.6 | Mọi luồng của prototype canvas chạy trên dữ liệu thật |
| **P5 · Studio** | Route `/studio/:kind`. Mỗi người có một canvas ẩn cho mỗi loại (Text, Image, Video, Audio); feed = lịch sử node đó. Re-edit, Regenerate, Delete, chi tiết run, Clone & try, **Keep**, Tải xuống, Add to canvas. History dock (chỉ media) đọc từ server | Ba trang media và trang Text chạy thật; kết quả được giữ hiện trong media browser |
| **P6 · Media browser** | Mặc định chỉ `kept`; công tắc "Hiện cả kết quả chưa giữ"; nút Keep / Unkeep trong chi tiết | Thư viện không bị lấp bởi các lần thử |

P1 và P2 làm song song được sau P0. P4 và P5 dùng chung `GenSource` thật nên làm P4 trước.

## 5. Ngoài phạm vi

- Thiết kế ngữ nghĩa Run đầy đủ (chạy lại phía dưới, cache, chạy hàng loạt): scope riêng của bạn.
- Chat kiểu Canvas Agent và agent chạy dài: dùng cùng engine vòng lặp ở P3, làm sau.
- Hạn ngạch và billing. `usage` vẫn ghi nhưng không hiện.
- Dọn các kết quả không được giữ (retention).

## 6. Còn cần bạn quyết

1. **`@asset` trên canvas** tự thêm node `input.asset` (đề xuất, để canvas thể hiện đủ flow) hay chỉ nằm trong prompt?
2. **Vòng lặp chất lượng ở P3** bật mặc định cho mọi run, hay bắt đầu bằng "Auto prompt" rồi mới thêm bước chấm điểm?
3. **Model cụ thể đợt đầu**: Seedream bản nào, Seedance bản nào, TTS nào, LLM nào. Plan cần danh sách để làm catalog.

## Nguồn

- [BytePlus ModelArk SDK overview](https://docs.byteplus.com/en/docs/ModelArk/1302007) · [OpenAI compatibility](https://docs.byteplus.com/api/docs/ModelArk/1330626) · [Video Generation API](https://docs.byteplus.com/en/docs/ModelArk/Video_Generation_API)
- [AI SDK 6](https://vercel.com/blog/ai-sdk-6) · [WorkflowAgent](https://vercel.com/kb/guide/what-is-workflowagent) · [@ai-sdk/bytedance](https://www.npmjs.com/package/@ai-sdk/bytedance)
