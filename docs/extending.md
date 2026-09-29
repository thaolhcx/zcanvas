# Add a node type

The optional `audio.sfx` example uses one registry JSON file and one worker, with registration in the server registry and worker list. No web/React Flow component changes are needed.

Enable it for a local demonstration:

```sh
ENABLE_SFX_EXAMPLE=1 pnpm dev
```

The palette gains **Sound effect**. Connect a Prompt's text output to it and Run. Its form, ports, validation, status and audio preview all use the existing canvas implementation. Production Playwright starts the example and exercises this flow automatically.

## Files

- `contracts/examples/extensions/audio.sfx.json`: definition with type/version, ports, params, runner and cost.
- `workers/src/sfx-example.ts`: one function that uses `ctx.models` and `ctx.putAsset`.
- `server/src/registry.ts` and `server/src/runner.ts`: optional registration alongside the eight default types.

To add a permanent type, place its JSON in `contracts/examples/registry/`, export its worker from `workers/src/index.ts`, and include it in the `workers` list. Restart the three dev processes. The browser loads the registry from `/registry` and the runner reads the same files.

Use `runner.kind: job`. Keep `worker.version` equal to the registry `version`; the runner refuses a missing version. Use only the provided `RunContext` for model requests, cancellation, progress and storing assets. Workers must tolerate re-execution after a process crash.

Registry UI overrides are optional. Standard param types (enum, number, string, boolean, asset, color, JSON), `showIf`, and `advanced` already render through the shared form. Do not put custom callbacks, graph mutations, status, or full file blobs into a node definition or recipe.

The example is automated implementation evidence. A different developer still needs to perform the independent <1-hour acceptance test described in the PRD.
