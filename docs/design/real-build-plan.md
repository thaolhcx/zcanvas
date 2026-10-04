# Làm thật: model thật, `@` thật, Studio và asset

Trạng thái: **plan, chưa làm**. Thay prototype ([node-prototype-summary.md](node-prototype-summary.md), Studio trong `web/prototype.html#studio`) bằng app thật. Prototype vẫn là bản thiết kế để đối chiếu; app thật không import gì từ `web/src/prototype`.

## 1. Đã chốt (2026-10-04)

| # | Quyết định | Ghi chú |
| --- | --- | --- |
| D1 | **Hai adapter:** BytePlus cho ảnh, video, giọng; LLM qua API tương thích OpenAI | BytePlus **không có SDK Node chính thức** (chỉ Python, Go, Java), nên adapter là client REST mỏng tự viết. **Không dùng hạ tầng của Vercel** (Workflow, WorkflowAgent, Fluid Compute): dễ phụ thuộc, chưa ổn định. Nếu dùng thư viện `ai` thì chỉ như một client LLM nằm gọn trong một file adapter, bỏ ra được bất cứ lúc nào. Cả hai nằm sau `ModelsClient` |
| D2 | **`@` phải link thật** tới asset, file upload hoặc node | Lưu theo id, không theo tên. Upload thành asset trước rồi mới được tham chiếu |
| D3 | Đưa kit (Composer, chip vai trò, `@`, feed) vào app thật | Kit vẫn không import xyflow hay store |
| D4 | Trang generate tên **Studio** | "Space" đã là không gian sở hữu asset (Personal / team) |
| D5 | **Lưu hết, thư viện chỉ hiện cái được giữ** | Mọi output vẫn thành asset (lịch sử, lineage). Media browser mặc định chỉ hiện asset `kept`. Upload luôn `kept` |
| D6 | **Mọi lần gọi model đều qua hàng đợi của mình** (pg-boss + Postgres), không bao giờ gọi đồng bộ trong request hay giữ job trong lúc chờ | Xem §3a |

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

## 3a. Hàng đợi sinh media (D6)

Hiện tại mỗi run là **một** job pg-boss (`canvas-run`). Bên trong job, worker `await` thẳng model, và giới hạn đồng thời là một `Map` trong bộ nhớ của process (`withWorkerSlot`). Với video mất vài phút, cách này giữ job suốt lúc chờ, mất task của nhà cung cấp khi restart (có thể gửi lại, tốn hai lần) và không giới hạn được giữa nhiều process.

Mô hình mới: **tạo task, hẹn giờ theo thời gian dự kiến, đến hạn thì lấy về**. Không có gì ngồi chờ, cũng không hỏi trạng thái dày đặc.

1. **Một node cần chạy = một job riêng** (`gen-submit`), không phải một bước trong job của run. Run chỉ điều phối: khi node phía trên xong thì đẩy job của node phía dưới.
2. **`gen-submit`** chiếm một slot của nhà cung cấp, tạo task, rồi **lưu `providerTaskId` và thời điểm dự kiến xong (ETA) vào Postgres trước khi trả về**. Khoá idempotency theo `jobId + attempt` để restart không tạo trùng.
3. **ETA** lấy từ thời gian thật của các lần trước, theo model và tham số chính (độ dài, độ phân giải, số ảnh). Dùng mức p50 để hẹn, p90 làm hạn chót mềm. Nhà cung cấp có trả ước lượng thì ưu tiên. Mỗi task xong lại cập nhật thống kê.
4. **`gen-fetch`** được hẹn đúng ETA (`sendAfter`). Đến hạn thì lấy kết quả: xong thì **tải file về kho của mình ngay** (URL của nhà cung cấp hết hạn, ảnh ModelArk chỉ sống 24 giờ), `putAsset`, phát `run_events`, nhả slot. Chưa xong thì hẹn lại theo phần thời gian còn lại, có trần số lần.
5. **Callback khi nhà cung cấp hỗ trợ** (`callback_url` của ModelArk): callback chỉ đánh thức `gen-fetch` sớm hơn, không thay nó. Mất callback thì lần hẹn theo ETA vẫn lấy về được.
6. **UI hiện thời gian dự kiến** ("≈ 1 phút 40 giây"), và vị trí trong hàng nếu đang chờ slot, thay cho thanh tiến độ giả.
7. **Slot và rate limit dùng chung** trong Postgres theo nhà cung cấp và model, ví dụ Seedance tối đa 10 task đồng thời cho mỗi model và giới hạn số request mỗi phút. Hết slot thì job chờ trong hàng, không gọi thử.
8. **Huỷ:** ModelArk chỉ huỷ được task **đang xếp hàng**. Task đã chạy thì dừng phía mình, vẫn lấy kết quả về khi xong (đã tốn tiền) và không đưa vào feed. Khớp với `ModelSpec.cancel: "queued"` của kit.
9. **Lỗi:** 429 và 5xx thử lại có giãn cách; lỗi nội dung hoặc tham số thì dừng ngay với thông báo dễ đọc. Quá hạn chót cứng thì huỷ nếu được và báo lỗi.
10. **Công bằng giữa người dùng:** mỗi người có trần số job đang chạy, để một người chạy hàng loạt không chặn người khác.
11. **LLM cũng đi qua hàng đợi** (node Text, các bước của vòng lặp chất lượng). Gọi nhanh thì `gen-submit` làm luôn, không cần `gen-fetch`.

Vòng lặp chất lượng (P3) và agent chạy dài sau này dùng cùng cơ chế: mỗi bước là một job, trạng thái nằm trong Postgres, chờ media thì ngủ đến ETA hoặc tới khi callback đánh thức. Không cần thư viện durable workflow nào.

**Mẫu tham khảo:** harness của AI SDK 6 (`Agent` là interface, `ToolLoopAgent` là bản mặc định): chỉ dẫn + tool + điều kiện dừng, móc trước và sau mỗi bước, tin nhắn chia phần (chữ, gọi tool, kết quả tool), tool cần người duyệt. Vòng lặp của mình theo đúng hình dạng đó để sau này có thể cài interface `Agent` lên hàng đợi của mình, dùng lại thư viện và UI của họ mà không phụ thuộc hạ tầng Vercel.

## 4. Các bước

| Bước | Nội dung | Xong khi |
| --- | --- | --- |
| **P0 · Contract** | Mục 3, kèm test contract và migration (`kept`, lịch sử job) | `pnpm test` xanh; registry và schema mới được validate |
| **P1 · Hàng đợi + adapter BytePlus** | Hàng đợi theo §3a (`gen-submit`, ETA, `gen-fetch` hẹn giờ, callback, slot dùng chung, huỷ, thử lại). Client REST: Seedream (tạo + sửa ảnh), Seedance (tạo task, hỏi trạng thái, huỷ), TTS. Config `ARK_API_KEY`, `ARK_BASE_URL`, map model. `signal` huỷ task thật. Lỗi nhà cung cấp thành lỗi job dễ đọc. Ghi `usage` (cho hạn ngạch sau này) | Chạy được ảnh, video, giọng thật với `MOCK_WORKERS=0`; restart giữa lúc sinh video không gửi trùng và vẫn lấy được kết quả; mock vẫn chạy cho test và e2e |
| **P2 · LLM** | Client OpenAI-compatible trỏ vào ModelArk, đi qua hàng đợi; worker `text.generate` (đọc ảnh, video, audio làm context nếu model hỗ trợ); Auto chọn model | Node Text chạy thật; đổi provider chỉ là đổi config |
| **P3 · Vòng lặp chất lượng (bản đầu)** | Mỗi run là một vòng lặp, mỗi bước là một job trong hàng đợi, trạng thái lưu trong Postgres: viết lại prompt → sinh → (tuỳ chọn) chấm bằng model nhìn được → thử lại. Có trần số lần và thời gian. Lưu **công thức cuối** (prompt cuối, model, tham số) vào `generation` | Run lưu được ý định gốc và công thức cuối; huỷ giữa vòng lặp giữ bản tốt nhất |
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

- [BytePlus ModelArk SDK overview](https://docs.byteplus.com/en/docs/ModelArk/1302007) · [OpenAI compatibility](https://docs.byteplus.com/api/docs/ModelArk/1330626) · [Video Generation API](https://docs.byteplus.com/en/docs/ModelArk/Video_Generation_API) · [Video generation tutorial](https://docs.byteplus.com/en/docs/modelark/video-generation-tutorial?redirect=1) · [3D task API (callback_url)](https://docs.byteplus.com/en/docs/modelark/shumei-create-3d-generation-task-api?redirect=1) · [Image generation API (URL 24 giờ)](https://docs.byteplus.com/en/docs/ModelArk/1541523)
- [AI SDK 6](https://vercel.com/blog/ai-sdk-6) · [@ai-sdk/bytedance](https://www.npmjs.com/package/@ai-sdk/bytedance)
