# Contracts source (verified)

Step 1 of the build order, done on 29 Sep 2026. All files below were run with `npm test`: **20 of 20 tests pass** (both schemas, the 8 node types, the pilot recipe, and one negative case per invariant). Copy these files into `contracts/` in the repo as they are.

## Test run

```
ok   registry: 8 types load and pass registry/v1
ok   pilot recipe passes recipe/v1 + all invariants
ok   inv 1: duplicate id
ok   inv 2: unknown type
ok   inv 2: old typeVersion without migrate
ok   inv 3: edge to missing port
ok   inv 4: kind mismatch text -> image
ok   inv 4: fan-out list<image> -> image is allowed
ok   inv 4: any passes the real kind through flow.if
ok   inv 5: two edges into one non-multiple input
ok   inv 6: cycle
ok   inv 4: nested list is refused
ok   inv 7: enum value not in options
ok   inv 7: number out of range
ok   inv 7: required param missing
ok   inv 7: required input not connected
ok   inv 8: groupId to missing group
ok   inv 9 / schema: meta.version must be integer
ok   schema: unknown field rejected
ok   registry schema: bad entry rejected

20 passed
```

Layout: `schemas/registry.schema.json`, `schemas/recipe.schema.json`, `examples/registry/*.json` (8 files), `examples/pilot.recipe.json`, `validate.mjs`, `test/run.mjs`, `package.json` (`type: module`, deps `ajv@8`, `ajv-formats@3`, script `test: node test/run.mjs`).

## schemas/registry.schema.json

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "registry/v1",
  "title": "Node type (registry/v1)",
  "type": "object",
  "additionalProperties": false,
  "required": ["type", "version", "title", "category", "inputs", "outputs", "params", "runner", "cost"],
  "properties": {
    "type": { "type": "string", "pattern": "^(input|video|audio|image|text|flow|output)\\.[a-z][a-z0-9_]*$" },
    "version": { "type": "integer", "minimum": 1 },
    "title": { "type": "string", "minLength": 1, "maxLength": 40 },
    "description": { "type": "string", "maxLength": 200 },
    "icon": { "type": "string" },
    "category": { "enum": ["input", "video", "audio", "image", "text", "flow", "output"] },
    "inputs": { "type": "array", "items": { "$ref": "#/$defs/port" } },
    "outputs": { "type": "array", "items": { "$ref": "#/$defs/port" } },
    "params": {
      "type": "object",
      "propertyNames": { "pattern": "^[a-z][a-zA-Z0-9]*$" },
      "additionalProperties": { "$ref": "#/$defs/param" }
    },
    "runner": { "$ref": "#/$defs/runner" },
    "cost": {
      "type": "object",
      "additionalProperties": false,
      "required": ["unit", "estimate"],
      "properties": {
        "unit": { "enum": ["credit_per_run", "credit_per_image", "credit_per_second", "credit_per_1k_chars"] },
        "estimate": { "type": "number", "minimum": 0 }
      }
    },
    "ui": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "body": { "type": "string", "description": "Optional custom body component name" },
        "width": { "type": "integer", "minimum": 200, "maximum": 600 },
        "previewPort": { "type": "string" }
      }
    },
    "migrate": { "type": "string", "description": "Module path exporting (params, fromVersion) => params" },
    "agentHints": { "type": "string", "maxLength": 200 }
  },
  "$defs": {
    "kind": {
      "type": "string",
      "pattern": "^(image|video|audio|text|json|any|list<(image|video|audio|text|json)>)$"
    },
    "port": {
      "type": "object",
      "additionalProperties": false,
      "required": ["key", "kind"],
      "properties": {
        "key": { "type": "string", "pattern": "^[a-z][a-zA-Z0-9]*$" },
        "kind": {
          "oneOf": [
            { "$ref": "#/$defs/kind" },
            { "type": "array", "minItems": 2, "uniqueItems": true, "items": { "$ref": "#/$defs/kind" } }
          ]
        },
        "required": { "type": "boolean", "default": false },
        "multiple": { "type": "boolean", "default": false },
        "label": { "type": "string" }
      }
    },
    "paramCommon": {
      "type": "object",
      "properties": {
        "label": { "type": "string" },
        "help": { "type": "string" },
        "required": { "type": "boolean" },
        "advanced": { "type": "boolean" },
        "showIf": {
          "type": "object",
          "additionalProperties": false,
          "required": ["key", "equals"],
          "properties": { "key": { "type": "string" }, "equals": {} }
        }
      }
    },
    "param": {
      "allOf": [{ "$ref": "#/$defs/paramCommon" }],
      "oneOf": [
        {
          "type": "object",
          "required": ["type", "options"],
          "properties": {
            "type": { "const": "enum" },
            "options": {
              "type": "array", "minItems": 1,
              "items": {
                "oneOf": [
                  { "type": "string" },
                  { "type": "object", "required": ["value", "label"], "properties": { "value": { "type": "string" }, "label": { "type": "string" } } }
                ]
              }
            },
            "default": { "type": "string" }
          }
        },
        {
          "type": "object",
          "required": ["type"],
          "properties": {
            "type": { "const": "number" },
            "min": { "type": "number" }, "max": { "type": "number" }, "step": { "type": "number", "exclusiveMinimum": 0 },
            "default": { "type": "number" }, "unit": { "type": "string" }
          }
        },
        {
          "type": "object",
          "required": ["type"],
          "properties": {
            "type": { "const": "string" },
            "multiline": { "type": "boolean" }, "placeholder": { "type": "string" }, "default": { "type": "string" }
          }
        },
        { "type": "object", "required": ["type"], "properties": { "type": { "const": "boolean" }, "default": { "type": "boolean" } } },
        { "type": "object", "required": ["type", "kind"], "properties": { "type": { "const": "asset" }, "kind": { "enum": ["image", "video", "audio"] } } },
        { "type": "object", "required": ["type"], "properties": { "type": { "const": "color" }, "default": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" } } },
        { "type": "object", "required": ["type", "schema"], "properties": { "type": { "const": "json" }, "schema": { "type": "object" } } }
      ]
    },
    "runner": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["kind", "worker"],
          "properties": {
            "kind": { "const": "job" },
            "worker": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
            "timeoutSec": { "type": "integer", "minimum": 1, "default": 300 },
            "concurrency": { "type": "integer", "minimum": 1, "default": 2 },
            "cacheable": { "type": "boolean", "default": true }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["kind"],
          "properties": { "kind": { "const": "flow" } }
        }
      ]
    }
  }
}
```

## schemas/recipe.schema.json

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "recipe/v1",
  "title": "Recipe (recipe/v1)",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema", "meta", "nodes", "edges", "groups"],
  "properties": {
    "schema": { "const": "recipe/v1" },
    "meta": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "name", "version", "registryVersion"],
      "properties": {
        "id": { "$ref": "#/$defs/id" },
        "name": { "type": "string", "minLength": 1, "maxLength": 120 },
        "version": { "type": "integer", "minimum": 0, "description": "Graph version; +1 per Graph API transaction" },
        "registryVersion": { "type": "string" },
        "updatedAt": { "type": "string", "format": "date-time" }
      }
    },
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "type", "typeVersion", "position", "params"],
        "properties": {
          "id": { "$ref": "#/$defs/id" },
          "type": { "type": "string", "pattern": "^(input|video|audio|image|text|flow|output)\\.[a-z][a-z0-9_]*$" },
          "typeVersion": { "type": "integer", "minimum": 1 },
          "label": { "type": "string", "maxLength": 80 },
          "position": { "$ref": "#/$defs/xy" },
          "params": { "type": "object" },
          "groupId": { "oneOf": [{ "$ref": "#/$defs/id" }, { "type": "null" }] }
        }
      }
    },
    "edges": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "source", "sourcePort", "target", "targetPort"],
        "properties": {
          "id": { "$ref": "#/$defs/id" },
          "source": { "$ref": "#/$defs/id" },
          "sourcePort": { "type": "string" },
          "target": { "$ref": "#/$defs/id" },
          "targetPort": { "type": "string" }
        }
      }
    },
    "groups": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "name", "position", "size"],
        "properties": {
          "id": { "$ref": "#/$defs/id" },
          "name": { "type": "string", "maxLength": 80 },
          "position": { "$ref": "#/$defs/xy" },
          "size": {
            "type": "object", "additionalProperties": false, "required": ["w", "h"],
            "properties": { "w": { "type": "number", "minimum": 1 }, "h": { "type": "number", "minimum": 1 } }
          }
        }
      }
    }
  },
  "$defs": {
    "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,64}$" },
    "xy": {
      "type": "object", "additionalProperties": false, "required": ["x", "y"],
      "properties": { "x": { "type": "number" }, "y": { "type": "number" } }
    }
  }
}
```

## examples/registry (8 node types)

### input.prompt.json

```json
{
  "type": "input.prompt", "version": 1, "title": "Prompt", "category": "input",
  "description": "A text value. The start of most flows.",
  "inputs": [],
  "outputs": [{ "key": "text", "kind": "text" }],
  "params": { "text": { "type": "string", "multiline": true, "required": true, "placeholder": "Describe the scene" } },
  "runner": { "kind": "flow" },
  "cost": { "unit": "credit_per_run", "estimate": 0 }
}
```

### input.asset.json

```json
{
  "type": "input.asset", "version": 1, "title": "Asset", "category": "input",
  "description": "Upload or pick an existing image, video or audio.",
  "inputs": [],
  "outputs": [{ "key": "asset", "kind": ["image", "video", "audio"] }],
  "params": { "asset": { "type": "asset", "kind": "image", "required": true, "label": "File" } },
  "runner": { "kind": "flow" },
  "cost": { "unit": "credit_per_run", "estimate": 0 },
  "ui": { "previewPort": "asset" }
}
```

### image.generate.json

```json
{
  "type": "image.generate", "version": 1, "title": "Generate image", "category": "image",
  "description": "Makes images from a prompt, with an optional reference image.",
  "inputs": [
    { "key": "prompt", "kind": "text", "required": true },
    { "key": "reference", "kind": "image", "required": false }
  ],
  "outputs": [{ "key": "image", "kind": "list<image>" }],
  "params": {
    "model": { "type": "enum", "options": ["seedream-4", "flux-2"], "default": "seedream-4" },
    "aspect": { "type": "enum", "options": ["1:1", "9:16", "16:9"], "default": "9:16" },
    "count": { "type": "number", "min": 1, "max": 4, "step": 1, "default": 1 },
    "seed": { "type": "number", "advanced": true }
  },
  "runner": { "kind": "job", "worker": "image-gen", "timeoutSec": 300, "concurrency": 4, "cacheable": true },
  "cost": { "unit": "credit_per_image", "estimate": 1 },
  "ui": { "previewPort": "image" },
  "agentHints": "First step of most visual flows. Use a reference image to keep a character consistent."
}
```

### image.edit.json

```json
{
  "type": "image.edit", "version": 1, "title": "Edit image", "category": "image",
  "description": "Changes an image by instruction: upscale, inpaint, restyle.",
  "inputs": [
    { "key": "image", "kind": "image", "required": true },
    { "key": "instruction", "kind": "text", "required": false }
  ],
  "outputs": [{ "key": "image", "kind": "image" }],
  "params": {
    "mode": { "type": "enum", "options": ["instruction", "upscale"], "default": "instruction" },
    "scale": { "type": "number", "min": 2, "max": 4, "step": 1, "default": 2, "showIf": { "key": "mode", "equals": "upscale" } }
  },
  "runner": { "kind": "job", "worker": "image-edit", "timeoutSec": 300, "concurrency": 4 },
  "cost": { "unit": "credit_per_image", "estimate": 1 },
  "ui": { "previewPort": "image" }
}
```

### video.generate.json

```json
{
  "type": "video.generate", "version": 1, "title": "Generate video", "category": "video",
  "description": "Image-to-video. Long job.",
  "inputs": [
    { "key": "image", "kind": "image", "required": true },
    { "key": "prompt", "kind": "text", "required": false }
  ],
  "outputs": [{ "key": "video", "kind": "video" }],
  "params": {
    "model": { "type": "enum", "options": ["seedance-1.5", "kling-2"], "default": "seedance-1.5" },
    "durationSec": { "type": "number", "min": 3, "max": 15, "step": 1, "default": 5, "unit": "s" }
  },
  "runner": { "kind": "job", "worker": "video-gen", "timeoutSec": 900, "concurrency": 2 },
  "cost": { "unit": "credit_per_second", "estimate": 2 },
  "ui": { "previewPort": "video" }
}
```

### audio.generate.json

```json
{
  "type": "audio.generate", "version": 1, "title": "Generate audio", "category": "audio",
  "description": "Voice from text, or music from a style prompt.",
  "inputs": [{ "key": "text", "kind": "text", "required": true }],
  "outputs": [{ "key": "audio", "kind": "audio" }],
  "params": {
    "mode": { "type": "enum", "options": ["voice", "music"], "default": "voice" },
    "voice": { "type": "enum", "options": ["alloy", "nova", "echo"], "default": "alloy", "showIf": { "key": "mode", "equals": "voice" } },
    "durationSec": { "type": "number", "min": 5, "max": 60, "step": 1, "default": 15, "unit": "s", "showIf": { "key": "mode", "equals": "music" } }
  },
  "runner": { "kind": "job", "worker": "audio-gen", "timeoutSec": 300, "concurrency": 4 },
  "cost": { "unit": "credit_per_1k_chars", "estimate": 0.5 }
}
```

### flow.if.json

```json
{
  "type": "flow.if", "version": 1, "title": "If", "category": "flow",
  "description": "Passes the input to one of two branches. The other branch is skipped.",
  "inputs": [{ "key": "value", "kind": "any", "required": true }],
  "outputs": [{ "key": "then", "kind": "any" }, { "key": "else", "kind": "any" }],
  "params": {
    "field": { "type": "string", "required": true, "placeholder": "meta.width" },
    "op": { "type": "enum", "options": ["eq", "neq", "gt", "lt", "contains"], "default": "eq" },
    "compare": { "type": "string", "required": true }
  },
  "runner": { "kind": "flow" },
  "cost": { "unit": "credit_per_run", "estimate": 0 }
}
```

### output.export.json

```json
{
  "type": "output.export", "version": 1, "title": "Export", "category": "output",
  "description": "Muxes video and audio and saves a named asset.",
  "inputs": [
    { "key": "video", "kind": "video", "required": true },
    { "key": "audio", "kind": "audio", "required": false }
  ],
  "outputs": [{ "key": "file", "kind": "video" }],
  "params": {
    "name": { "type": "string", "required": true, "placeholder": "final-cut" },
    "format": { "type": "enum", "options": ["mp4", "webm"], "default": "mp4" }
  },
  "runner": { "kind": "job", "worker": "export", "timeoutSec": 300, "cacheable": false },
  "cost": { "unit": "credit_per_run", "estimate": 0 },
  "ui": { "previewPort": "file" }
}
```

## examples/pilot.recipe.json

```json
{
  "schema": "recipe/v1",
  "meta": { "id": "rcp_pilot", "name": "Character short", "version": 7, "registryVersion": "2026.09.1", "updatedAt": "2026-09-29T10:12:00Z" },
  "nodes": [
    { "id": "n_prompt", "type": "input.prompt", "typeVersion": 1, "label": "Scene prompt", "position": { "x": 0, "y": 0 },
      "params": { "text": "A girl in a red coat on a rainy street, cinematic" }, "groupId": "g_1" },
    { "id": "n_img", "type": "image.generate", "typeVersion": 1, "position": { "x": 360, "y": 0 },
      "params": { "model": "seedream-4", "aspect": "9:16", "count": 2 }, "groupId": "g_1" },
    { "id": "n_edit", "type": "image.edit", "typeVersion": 1, "position": { "x": 720, "y": 0 },
      "params": { "mode": "upscale", "scale": 2 }, "groupId": "g_1" },
    { "id": "n_if", "type": "flow.if", "typeVersion": 1, "label": "Portrait?", "position": { "x": 1080, "y": 0 },
      "params": { "field": "meta.height", "op": "gt", "compare": "1000" } },
    { "id": "n_vid", "type": "video.generate", "typeVersion": 1, "position": { "x": 1440, "y": -80 },
      "params": { "model": "seedance-1.5", "durationSec": 5 } },
    { "id": "n_voice", "type": "audio.generate", "typeVersion": 1, "position": { "x": 1440, "y": 160 },
      "params": { "mode": "voice", "voice": "nova" } },
    { "id": "n_out", "type": "output.export", "typeVersion": 1, "position": { "x": 1800, "y": 0 },
      "params": { "name": "character-short", "format": "mp4" } }
  ],
  "edges": [
    { "id": "e_1", "source": "n_prompt", "sourcePort": "text",  "target": "n_img",   "targetPort": "prompt" },
    { "id": "e_2", "source": "n_img",    "sourcePort": "image", "target": "n_edit",  "targetPort": "image" },
    { "id": "e_3", "source": "n_edit",   "sourcePort": "image", "target": "n_if",    "targetPort": "value" },
    { "id": "e_4", "source": "n_if",     "sourcePort": "then",  "target": "n_vid",   "targetPort": "image" },
    { "id": "e_5", "source": "n_prompt", "sourcePort": "text",  "target": "n_voice", "targetPort": "text" },
    { "id": "e_6", "source": "n_vid",    "sourcePort": "video", "target": "n_out",   "targetPort": "video" },
    { "id": "e_7", "source": "n_voice",  "sourcePort": "audio", "target": "n_out",   "targetPort": "audio" }
  ],
  "groups": [
    { "id": "g_1", "name": "Shot 1 · image", "position": { "x": -20, "y": -60 }, "size": { "w": 1060, "h": 300 } }
  ]
}
```

## validate.mjs

```js
// validate.mjs — registry/v1 + recipe/v1 schema check and the 9 recipe invariants.
// Pure module: no UI, no server. Same code runs on client and server.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const registrySchema = ajv.compile(JSON.parse(readFileSync(join(here, 'schemas/registry.schema.json'))));
const recipeSchema  = ajv.compile(JSON.parse(readFileSync(join(here, 'schemas/recipe.schema.json'))));

export function loadRegistry(dir) {
  const reg = new Map();
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const t = JSON.parse(readFileSync(join(dir, f)));
    if (!registrySchema(t)) throw new Error(`registry ${f}: ${ajv.errorsText(registrySchema.errors)}`);
    if (reg.has(t.type)) throw new Error(`registry: duplicate type ${t.type}`);
    reg.set(t.type, t);
  }
  return reg;
}

// --- kinds ---------------------------------------------------------------
const isList = k => typeof k === 'string' && k.startsWith('list<');
const inner  = k => k.slice(5, -1);
const accepts = (declared, actual) => {
  // declared: port kind (string or array of kinds); actual: a concrete kind string
  const opts = Array.isArray(declared) ? declared : [declared];
  return opts.some(d => d === 'any' || d === actual);
};

/** Returns Issue[]: { code, severity, nodeId?, edgeId?, paramKey?, message } */
export function validate(recipe, registry) {
  const issues = [];
  const err = (code, message, where = {}) => issues.push({ code, severity: 'error', message, ...where });

  if (!recipeSchema(recipe)) {
    for (const e of recipeSchema.errors) err('SCHEMA', `${e.instancePath} ${e.message}`);
    return issues;
  }

  // 1. unique ids
  const seen = new Set();
  for (const x of [...recipe.nodes, ...recipe.edges, ...recipe.groups]) {
    if (seen.has(x.id)) err('DUP_ID', `duplicate id ${x.id}`, { nodeId: x.id });
    seen.add(x.id);
  }
  const nodes = new Map(recipe.nodes.map(n => [n.id, n]));
  const groups = new Set(recipe.groups.map(g => g.id));

  // 2. types exist, version known
  for (const n of recipe.nodes) {
    const t = registry.get(n.type);
    if (!t) { err('UNKNOWN_TYPE', `unknown type ${n.type}`, { nodeId: n.id }); continue; }
    if (n.typeVersion !== t.version && !t.migrate)
      err('VERSION', `${n.type} v${n.typeVersion} has no migrate path to v${t.version}`, { nodeId: n.id });
  }

  // 3. edges name existing nodes and ports; 5. at most one edge per input port unless multiple
  const inCount = new Map();
  for (const e of recipe.edges) {
    const s = nodes.get(e.source), t = nodes.get(e.target);
    if (!s || !t) { err('EDGE_NODE', `edge ${e.id} names a missing node`, { edgeId: e.id }); continue; }
    const st = registry.get(s.type), tt = registry.get(t.type);
    if (!st || !tt) continue;
    const sp = st.outputs.find(p => p.key === e.sourcePort);
    const tp = tt.inputs.find(p => p.key === e.targetPort);
    if (!sp) err('EDGE_PORT', `edge ${e.id}: ${s.type} has no output ${e.sourcePort}`, { edgeId: e.id });
    if (!tp) err('EDGE_PORT', `edge ${e.id}: ${t.type} has no input ${e.targetPort}`, { edgeId: e.id });
    const key = `${e.target}.${e.targetPort}`;
    inCount.set(key, (inCount.get(key) ?? 0) + 1);
    if (tp && !tp.multiple && inCount.get(key) > 1)
      err('FAN_IN', `${key} has more than one incoming edge`, { edgeId: e.id, nodeId: e.target });
  }

  // 6. no cycles (Kahn), and a topological order for kind inference
  const indeg = new Map(recipe.nodes.map(n => [n.id, 0]));
  const out = new Map(recipe.nodes.map(n => [n.id, []]));
  for (const e of recipe.edges) if (nodes.has(e.source) && nodes.has(e.target)) {
    indeg.set(e.target, indeg.get(e.target) + 1); out.get(e.source).push(e);
  }
  const order = []; const q = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
  while (q.length) { const id = q.shift(); order.push(id); for (const e of out.get(id)) { indeg.set(e.target, indeg.get(e.target) - 1); if (indeg.get(e.target) === 0) q.push(e.target); } }
  if (order.length !== recipe.nodes.length) err('CYCLE', 'graph has a cycle');

  // 4. kinds match, with fan-out. Effective kinds are inferred in topological order.
  //    fannedOut(node) = some input receives list<x> on a port declared x.
  //    Then every declared output y of that node is effectively list<y>. Nested lists are not allowed.
  //    'any' output ports take the effective kind of the node's 'any' input.
  const effOut = new Map(); // nodeId -> Map(portKey -> effective kind)
  const fanned = new Set();
  for (const id of order) {
    const n = nodes.get(id); const t = registry.get(n.type); if (!t) continue;
    let anyIn = null; let fan = false;
    for (const e of recipe.edges.filter(e => e.target === id)) {
      const tp = t.inputs.find(p => p.key === e.targetPort); if (!tp) continue;
      const actual = effOut.get(e.source)?.get(e.sourcePort); if (!actual) continue;
      if (accepts(tp.kind, actual)) { if (tp.kind === 'any') anyIn = actual; continue; }
      if (isList(actual) && accepts(tp.kind, inner(actual))) { fan = true; if (tp.kind === 'any') anyIn = inner(actual); continue; }
      err('KIND', `edge ${e.id}: ${actual} -> ${JSON.stringify(tp.kind)} is not allowed`, { edgeId: e.id, nodeId: id });
    }
    if (fan) fanned.add(id);
    const m = new Map();
    for (const p of t.outputs) {
      let k = p.kind === 'any' ? (anyIn ?? 'any') : (Array.isArray(p.kind) ? p.kind[0] : p.kind);
      if (fan) { if (isList(k)) err('NESTED_LIST', `${id}: fan-out would make list<list<...>>`, { nodeId: id }); else k = `list<${k}>`; }
      m.set(p.key, k);
    }
    effOut.set(id, m);
  }

  // 7. params valid, required set;  required inputs connected
  for (const n of recipe.nodes) {
    const t = registry.get(n.type); if (!t) continue;
    for (const [k, v] of Object.entries(n.params)) {
      const p = t.params[k];
      if (!p) { err('PARAM_UNKNOWN', `${n.type} has no param ${k}`, { nodeId: n.id, paramKey: k }); continue; }
      const bad = (
        (p.type === 'enum'    && !p.options.map(o => typeof o === 'string' ? o : o.value).includes(v)) ||
        (p.type === 'number'  && (typeof v !== 'number' || (p.min != null && v < p.min) || (p.max != null && v > p.max))) ||
        (p.type === 'string'  && typeof v !== 'string') ||
        (p.type === 'boolean' && typeof v !== 'boolean') ||
        (p.type === 'asset'   && typeof v !== 'string') ||
        (p.type === 'color'   && !/^#[0-9a-fA-F]{6}$/.test(String(v)))
      );
      if (bad) err('PARAM_VALUE', `${n.type}.${k}: ${JSON.stringify(v)} is not valid`, { nodeId: n.id, paramKey: k });
    }
    for (const [k, p] of Object.entries(t.params))
      if (p.required && n.params[k] == null && p.default == null) err('PARAM_REQUIRED', `${n.type}.${k} is required`, { nodeId: n.id, paramKey: k });
    for (const p of t.inputs)
      if (p.required && !recipe.edges.some(e => e.target === n.id && e.targetPort === p.key))
        err('INPUT_REQUIRED', `${n.id}: input ${p.key} is not connected`, { nodeId: n.id });
  }

  // 8. groupId points to an existing group
  for (const n of recipe.nodes)
    if (n.groupId && !groups.has(n.groupId)) err('GROUP', `${n.id}: group ${n.groupId} does not exist`, { nodeId: n.id });

  // 9. meta.version is an integer >= 0 — enforced by the schema.
  return issues;
}

export function checkRegistryEntry(entry) {
  return registrySchema(entry) ? [] : registrySchema.errors.map(e => `${e.instancePath} ${e.message}`);
}
```

## test/run.mjs

```js
import { loadRegistry, validate, checkRegistryEntry } from '../validate.mjs';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const reg = loadRegistry(new URL('../examples/registry/', import.meta.url).pathname);
const pilot = JSON.parse(readFileSync(new URL('../examples/pilot.recipe.json', import.meta.url)));
const clone = () => structuredClone(pilot);
let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n     ', e.message); process.exitCode = 1; } };
const codes = r => validate(r, reg).map(i => i.code);

t('registry: 8 types load and pass registry/v1', () => assert.equal(reg.size, 8));
t('pilot recipe passes recipe/v1 + all invariants', () => assert.deepEqual(codes(pilot), []));
t('inv 1: duplicate id', () => { const r = clone(); r.edges[0].id = 'n_img'; assert.ok(codes(r).includes('DUP_ID')); });
t('inv 2: unknown type', () => { const r = clone(); r.nodes[0].type = 'text.nope'; assert.ok(codes(r).includes('UNKNOWN_TYPE')); });
t('inv 2: old typeVersion without migrate', () => { const r = clone(); r.nodes[1].typeVersion = 9; assert.ok(codes(r).includes('VERSION')); });
t('inv 3: edge to missing port', () => { const r = clone(); r.edges[0].targetPort = 'nope'; assert.ok(codes(r).includes('EDGE_PORT')); });
t('inv 4: kind mismatch text -> image', () => { const r = clone(); r.edges.push({ id: 'e_bad', source: 'n_prompt', sourcePort: 'text', target: 'n_vid', targetPort: 'prompt' }); r.edges.push({ id: 'e_bad2', source: 'n_voice', sourcePort: 'audio', target: 'n_edit', targetPort: 'instruction' }); assert.ok(codes(r).includes('KIND')); });
t('inv 4: fan-out list<image> -> image is allowed', () => assert.deepEqual(codes(pilot), []));
t('inv 4: any passes the real kind through flow.if', () => { const r = clone(); r.edges.find(e => e.id === 'e_4').targetPort = 'prompt'; assert.ok(codes(r).includes('KIND'), 'image into a text port must fail even through any'); });
t('inv 5: two edges into one non-multiple input', () => { const r = clone(); r.edges.push({ id: 'e_dup', source: 'n_prompt', sourcePort: 'text', target: 'n_img', targetPort: 'prompt' }); assert.ok(codes(r).includes('FAN_IN')); });
t('inv 6: cycle', () => { const r = clone(); r.edges.push({ id: 'e_cyc', source: 'n_edit', sourcePort: 'image', target: 'n_img', targetPort: 'reference' }); assert.ok(codes(r).includes('CYCLE')); });
t('inv 4: nested list is refused', () => { const r = clone(); r.nodes.push({ id: 'n_img2', type: 'image.generate', typeVersion: 1, position: { x: 0, y: 300 }, params: {} }); r.edges.push({ id: 'e_p2', source: 'n_prompt', sourcePort: 'text', target: 'n_img2', targetPort: 'prompt' }, { id: 'e_ref', source: 'n_edit', sourcePort: 'image', target: 'n_img2', targetPort: 'reference' }); assert.ok(codes(r).includes('NESTED_LIST')); });
t('inv 7: enum value not in options', () => { const r = clone(); r.nodes[1].params.model = 'dalle'; assert.ok(codes(r).includes('PARAM_VALUE')); });
t('inv 7: number out of range', () => { const r = clone(); r.nodes[1].params.count = 9; assert.ok(codes(r).includes('PARAM_VALUE')); });
t('inv 7: required param missing', () => { const r = clone(); delete r.nodes[6].params.name; assert.ok(codes(r).includes('PARAM_REQUIRED')); });
t('inv 7: required input not connected', () => { const r = clone(); r.edges = r.edges.filter(e => e.id !== 'e_6'); assert.ok(codes(r).includes('INPUT_REQUIRED')); });
t('inv 8: groupId to missing group', () => { const r = clone(); r.nodes[0].groupId = 'g_x'; assert.ok(codes(r).includes('GROUP')); });
t('inv 9 / schema: meta.version must be integer', () => { const r = clone(); r.meta.version = 1.5; assert.ok(codes(r).includes('SCHEMA')); });
t('schema: unknown field rejected', () => { const r = clone(); r.nodes[0].color = 'red'; assert.ok(codes(r).includes('SCHEMA')); });
t('registry schema: bad entry rejected', () => { const bad = structuredClone(reg.get('image.generate')); bad.outputs[0].kind = 'list<list<image>>'; bad.extra = 1; assert.ok(checkRegistryEntry(bad).length >= 2); });
console.log(`\n${pass} passed`);
```
