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

## 3. Contract cần chốt trước khi code

Mỗi mục ghi giai đoạn cần nó: **A** = provider + Studio (làm trước), **B** = canvas (làm sau).

1. **(A) Catalog model** phía server: `GET /models` trả `ModelSpec` (id, kind, fields, accepts, cancel). Kit vẽ tham số từ đây. Node chỉ giữ `model` (hoặc `auto`), `mode`, `prompt` và `params` của model. Xem lại phần "hai hệ type" trong [node-architecture-review.md](node-architecture-review.md).
2. **(A: `asset:`, B: `node:`) Prompt có tham chiếu.** Param `prompt` là chuỗi có token, ví dụ `@[Logo](asset:ast_123)` và `@[Key visual](node:n_abc)`. Tên chỉ để hiển thị; đổi tên node hay asset không làm hỏng link. Runner đổi token thành danh sách tham chiếu có thứ tự và viết lại theo quy ước của model (ví dụ "image 1").
   - `node:` phải có edge thật tới node đó. Gõ `@` chọn một node chưa nối thì **tự tạo edge** (kèm vai trò), để canvas luôn thể hiện đúng flow.
   - `asset:` **luôn đi kèm node `input.asset` + edge** (đã chốt). Trên canvas, người dùng thấy node đó. Canvas ẩn của Studio cũng làm y như vậy, chỉ là không hiện ra, nên runner chỉ có một đường đọc tham chiếu.
   - Upload: tải lên thành asset trước (`POST /assets`), rồi thành `asset:`.
   - Tham chiếu hỏng (asset đã xoá, node đã xoá) là lỗi kiểm tra trước khi chạy, giống `INPUT_REQUIRED`.
3. **(A) Vai trò trên edge.** `RecipeEdge.targetPort` mang vai trò (`first`, `last`, `source`, `reference`, `voice`…), khớp `RoleSpec` của kit.
4. **(A) Node `text.generate`.** Input `context` (nhiều, mọi kind), param `preset`, `system`, `model`, `effort`, `useOwnText` (chỉ trên canvas).
5. **(A) Asset `kept`.** Cột `assets.kept boolean`, upload = `true`, generated = `false`. `GET /assets` mặc định `kept=true`, có `kept=all`. `POST /assets/:id/keep` và `/unkeep`. Kéo một kết quả vào canvas, tải xuống hoặc dùng làm tham chiếu thì tự `keep`.
6. **(A) Lịch sử theo node.** `GET /canvases/:id/nodes/:nodeId/history`: các lần chạy của node qua mọi run (job + output + snapshot giá trị). Retry **không xoá** job cũ nữa mà đánh dấu thay thế.
7. **(A) Chạy một node.** `POST /runs` nhận `target: nodeId`: chạy node đó và phần phía trên còn thiếu (dùng `output_cache`). Chi tiết ngữ nghĩa Run vẫn là scope riêng của bạn; đây chỉ là mức tối thiểu để Composer và Studio chạy được.
8. **(A) Bỏ seed** khỏi registry (`image.generate`). `GenerationProvider.seed` vẫn giữ nếu nhà cung cấp trả về, vì đó là dữ liệu lineage, không hiện trên UI.
9. **(A) Auto prompt** (bản đầu của vòng lặp chất lượng, đã chốt). Param `autoPrompt` cho node Image, Video, Audio, mặc định bật. Bật thì trước khi sinh có một bước LLM viết lại prompt theo model và các tham chiếu (giữ nguyên token `@`). `generation` lưu cả **ý định** (prompt người dùng gõ) và **prompt cuối** đã gửi. Chi tiết run hiện cả hai; Re-edit và Clone & try lấy ý định, Regenerate dùng lại prompt cuối.

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

Vòng lặp chất lượng và agent chạy dài sau này dùng cùng cơ chế: mỗi bước là một job, trạng thái nằm trong Postgres, chờ media thì ngủ đến ETA hoặc tới khi callback đánh thức. Không cần thư viện durable workflow nào.

**Mẫu tham khảo:** harness của AI SDK 6 (`Agent` là interface, `ToolLoopAgent` là bản mặc định): chỉ dẫn + tool + điều kiện dừng, móc trước và sau mỗi bước, tin nhắn chia phần (chữ, gọi tool, kết quả tool), tool cần người duyệt. Vòng lặp của mình theo đúng hình dạng đó để sau này có thể cài interface `Agent` lên hàng đợi của mình, dùng lại thư viện và UI của họ mà không phụ thuộc hạ tầng Vercel.

## 3b. Port provider BytePlus có sẵn

Nguồn: nhánh `byteplus-provider` của `thaolhcx/nodetool` (repo riêng tư): `docs/byteplus-provider.md`, `docs/byteplus-handoff.md`, `packages/runtime/src/providers/byteplus-{provider,media,assets}.ts`, `packages/cli/scripts/byteplus-live-probe.ts`. Đã chạy thật với key của chủ repo cho Seedream và Seedance.

**Mang sang:**
- **Cách gửi request:** Seedream `POST {base}/images/generations`; Seedance `POST {base}/contents/generations/tasks` với `content` có `role` (`first_frame`, `last_frame`, `reference_image`, `reference_audio`, `reference_video`), thứ tự ảnh → audio → video; Seed Audio TTS ở host Voice riêng với `X-Api-Key`; LLM qua `/chat/completions` tương thích OpenAI.
- **Giới hạn học từ lỗi 400 thật** → đưa vào catalog model để UI chặn trước: Seedance 2.5 nhận 4–30 giây (họ 2.0: 4–15), số nguyên; Seedream tối thiểu 1280×720 pixel, Seedream 5.0 Pro tối đa 4.624.220 pixel và không có preset 4K; preset `1K/2K` bỏ qua tỉ lệ nên gửi `WxH`; có khung đầu thì không gửi `ratio`. Lỗi 400 nêu giới hạn pixel thì co giãn và thử lại một lần.
- **Tham chiếu qua TOS + `asset://`:** file tham chiếu đưa lên TOS theo sha256; kiểm tra người thật bằng Seed vision (chế độ `verify`); người thật thì đăng ký Assets (ký HMAC AK/SK) và gửi `asset://`; còn lại gửi URL ký trước 1 giờ. Lưới an toàn lúc gửi: tham chiếu thứ N bị chặn thì đăng ký rồi thử lại; id hết hạn thì đăng ký lại; vẫn bị chặn thì **báo lỗi rõ**, không bao giờ lặng lẽ bỏ tham chiếu. Prompt bị chặn thì báo lỗi, không đăng ký gì.
- **Lỗi:** 429, 5xx và lỗi mạng là tạm thời; 4xx khác dừng ngay với thông báo của API.
- **Cấu hình:** `BYTEPLUS_API_KEY`, `BYTEPLUS_BASE_URL`, `BYTEPLUS_VOICE_API_KEY`, `BYTEPLUS_VOICE_BASE_URL`, `BYTEPLUS_ACCESS_KEY` / `BYTEPLUS_SECRET_KEY`, `BYTEPLUS_TOS_*`, `BYTEPLUS_ASSET_MODE`, `BYTEPLUS_ASSET_GROUP_ID`, `BYTEPLUS_VERIFY_MODEL`; model thêm và endpoint riêng của tài khoản (`ep-…`) qua `BYTEPLUS_{LANGUAGE,IMAGE,VIDEO}_MODELS`. Key chỉ nằm trong env, không bao giờ trong commit hay log.
- **Script chạy thử với key thật** (tốn tiền, rẻ trước đắt sau) và **test dùng response ghi sẵn**.

**Đổi khi port:**
- **Video không ngồi chờ.** Bản gốc gửi task rồi hỏi mỗi 5 giây trong cùng lời gọi (tối đa 30 phút). Tách thành `submit` (đưa lên TOS, xác định tham chiếu, gửi, lưới an toàn) → trả `taskId`, và `fetch` (đọc trạng thái một lần, tải file) theo §3a.
- **Huỷ thật:** gọi API huỷ của ModelArk cho task còn `queued`. Bản gốc chỉ dừng phía mình.
- **Bộ nhớ đệm vào Postgres:** bảng `sha256 → tos_key, byteplus_asset_id, real_person, asset_type` thay cho file `.meta.json` cạnh object trên TOS. Vòng đời object TOS (ví dụ xoá sau 30 ngày) vẫn giữ; object hết hạn thì đưa lên lại.
- **Kiểm tra người thật là một bước trong hàng đợi**, không gọi lồng trong bước gửi.
- **Không gửi `seed`.**
- **Giấy phép:** bản gốc kế thừa lớp `OpenAICompatProvider` của NodeTool (AGPL-3.0). Chỉ port phần logic BytePlus của chủ repo, viết lại theo `ModelsClient` của zcanvas; không chép code gốc NodeTool.

**Chưa thử thật** (làm trong script chạy thử trước khi bật): `asset://` có qua bước chặn người thật trên tài khoản này không; `asset://` cho video và audio; định dạng lỗi chặn đầu vào; Seed Audio TTS.

**Model đợt đầu:** LLM `seed-2-0-pro-260328`; ảnh `dola-seedream-5-0-pro-260628` (Seedream 5.0 Pro); video `dreamina-seedance-2-5-260628` (Seedance 2.5, cần resource pack 2.5); TTS `seed-audio-1.0`. Seedance 2.0 / Fast / Mini và Seedream Lite thêm qua endpoint `ep-…`.

## 4. Các bước

Viết provider và **thử trên Studio trước** (giai đoạn A). Canvas thật làm sau (giai đoạn B), dùng lại mọi thứ của A.

### Giai đoạn A: provider + Studio

| Bước | Nội dung | Xong khi |
| --- | --- | --- |
| **A0 · Contract** | Các mục (A) ở §3, kèm test contract và migration (`kept`, lịch sử job, vai trò trên edge, canvas ẩn của Studio) | `pnpm test` xanh; registry và schema mới được validate |
| **A1 · Hàng đợi + adapter BytePlus** | Hàng đợi theo §3a (`gen-submit`, ETA, `gen-fetch` hẹn giờ, callback, slot dùng chung, huỷ, thử lại). Adapter BytePlus **port từ provider đã chạy thật** (§3b): Seedream (tạo + sửa ảnh), Seedance (gửi task / lấy kết quả, huỷ task đang xếp hàng), Seed Audio TTS, tham chiếu qua TOS + `asset://`. Mock cũng đi qua cùng hàng đợi (ETA giả). Ghi `usage`. Script chạy thử với key thật + test dùng response ghi sẵn | Script chạy thử ra ảnh, video, giọng thật với `MOCK_WORKERS=0`; restart giữa lúc sinh video không gửi trùng và vẫn lấy được kết quả; mock vẫn chạy cho test và e2e |
| **A2 · Studio Image, Video, Audio** | Route `/studio/:kind`. Mỗi người có một canvas ẩn cho mỗi loại; feed = lịch sử node đó. Composer của kit qua `GenSource` thật; upload và chọn từ thư viện thành asset + node `input.asset` + edge có vai trò; `@` gợi ý các tham chiếu đó. Thẻ đang chạy hiện thời gian dự kiến. Re-edit, Regenerate, Delete, chi tiết run, Clone & try, **Keep**, Tải xuống. History dock (chỉ media) đọc từ server | Ba trang chạy thật bằng BytePlus; huỷ, lỗi và restart hiện đúng trên feed |
| **A3 · LLM + Text + Auto prompt** | Client tương thích OpenAI trỏ vào ModelArk, đi qua hàng đợi; worker `text.generate`; trang Text của Studio; Auto prompt (§3 mục 9) cho Image, Video, Audio | Trang Text chạy thật; bật Auto prompt thì chi tiết run hiện ý định và prompt cuối |
| **A4 · Media browser** | Mặc định chỉ `kept`; công tắc "Hiện cả kết quả chưa giữ"; Keep / Unkeep trong chi tiết | Thư viện chỉ có cái được giữ và file upload |

A1 và A2 làm song song được sau A0: A2 chạy trên mock trước, rồi chuyển sang BytePlus khi A1 xong.

### Giai đoạn B: canvas thật

| Bước | Nội dung | Xong khi |
| --- | --- | --- |
| **B1 · Kit vào canvas** | Node generate dùng Composer của kit qua `GenSource` đọc Graph (Yjs); `@node` tự tạo edge kèm vai trò; `@asset` thêm node `input.asset` + edge; chip vai trò ghi lên edge; lịch sử node; chạy một node; Add to canvas từ Studio | Mọi luồng của prototype canvas chạy trên dữ liệu thật |
| **B2 · Vòng lặp chất lượng đầy đủ** | Thêm bước chấm bằng model nhìn được và thử lại, mỗi bước là một job; trần số lần và thời gian; huỷ giữ bản tốt nhất | Một run có thể tự sửa và chọn bản tốt nhất |

## 5. Ngoài phạm vi

- Thiết kế ngữ nghĩa Run đầy đủ (chạy lại phía dưới, cache, chạy hàng loạt): scope riêng của bạn.
- Chat kiểu Canvas Agent và agent chạy dài: dùng cùng engine vòng lặp, làm sau.
- Hạn ngạch và billing. `usage` vẫn ghi nhưng không hiện.
- Dọn các kết quả không được giữ (retention).

## 6. Đã trả lời

1. `@asset` trên canvas **có** tự thêm node `input.asset` + edge (§3 mục 2).
2. Vòng lặp chất lượng **bắt đầu bằng Auto prompt** (§3 mục 9, bước A3); chấm điểm và thử lại ở B2.

## Nguồn

- [BytePlus ModelArk SDK overview](https://docs.byteplus.com/en/docs/ModelArk/1302007) · [OpenAI compatibility](https://docs.byteplus.com/api/docs/ModelArk/1330626) · [Video Generation API](https://docs.byteplus.com/en/docs/ModelArk/Video_Generation_API) · [Video generation tutorial](https://docs.byteplus.com/en/docs/modelark/video-generation-tutorial?redirect=1) · [3D task API (callback_url)](https://docs.byteplus.com/en/docs/modelark/shumei-create-3d-generation-task-api?redirect=1) · [Image generation API (URL 24 giờ)](https://docs.byteplus.com/en/docs/ModelArk/1541523)
- Provider gốc: nhánh `byteplus-provider` của `thaolhcx/nodetool` (riêng tư)
- [AI SDK 6](https://vercel.com/blog/ai-sdk-6) · [@ai-sdk/bytedance](https://www.npmjs.com/package/@ai-sdk/bytedance)
