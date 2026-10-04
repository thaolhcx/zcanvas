// validate.mjs — registry/v1 + recipe/v1 schema check and the 9 recipe invariants.
// Pure module: no UI, no server. Same code runs on client and server.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import registryDefinition from './schemas/registry.schema.json' with { type: 'json' };
import recipeDefinition from './schemas/recipe.schema.json' with { type: 'json' };
import modelDefinition from './schemas/model.schema.json' with { type: 'json' };
import { resolveModel, inputProblems, fieldProblem } from './models.ts';
import { promptRefs } from './prompt.ts';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const registrySchema = ajv.compile(registryDefinition);
const recipeSchema = ajv.compile(recipeDefinition);
const modelSchema = ajv.compile(modelDefinition);

// --- kinds ---------------------------------------------------------------
const isList = k => typeof k === 'string' && k.startsWith('list<');
const inner  = k => k.slice(5, -1);
const accepts = (declared, actual) => {
  // declared: port kind (string or array of kinds); actual: a concrete kind string
  const opts = Array.isArray(declared) ? declared : [declared];
  const kinds = Array.isArray(actual) ? actual : [actual];
  return opts.some(d => d === 'any' || kinds.some(k => k === 'any' || d === k));
};

const strip = k => (isList(k) ? inner(k) : k);
/** The node's current mode: its `mode` param, else the param's default, else the first mode. */
export function modeOf(node, type) {
  if (!type?.modes) return undefined;
  const v = node.params.mode ?? type.params.mode?.default;
  return typeof v === 'string' ? v : type.modes[0].value;
}
const inMode = (port, mode) => !port.modes || mode === undefined || port.modes.includes(mode);

/**
 * Returns Issue[]: { code, severity, nodeId?, edgeId?, paramKey?, message }.
 * With `models` (the catalog), model params are checked against the model a node
 * runs; without it, params a node keeps for its model are not judged.
 * `assetKinds` (asset id → kind) tells what an input.asset node holds.
 */
export function validate(recipe, registry, models, assetKinds) {
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
    if (n.typeVersion > t.version || (n.typeVersion !== t.version && !t.migrate))
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
      let k = p.kind === 'any' ? (anyIn ?? 'any') : p.kind;
      if (fan) { if (isList(k)) err('NESTED_LIST', `${id}: fan-out would make list<list<...>>`, { nodeId: id }); else k = `list<${k}>`; }
      m.set(p.key, k);
    }
    effOut.set(id, m);
  }

  // 7. params valid, required set;  required inputs connected
  for (const n of recipe.nodes) {
    const t = registry.get(n.type); if (!t) continue;
    const modelParam = Object.entries(t.params).find(([, p]) => p.type === 'model');
    const mode = modeOf(n, t);
    // Kinds arriving at this node (lists count as their items).
    const kinds = recipe.edges.filter(e => e.target === n.id).map(e => {
      const actual = effOut.get(e.source)?.get(e.sourcePort);
      const port = t.inputs.find(p => p.key === e.targetPort);
      if (!actual || !port) return undefined;
      const src = nodes.get(e.source);
      if (src?.type === 'input.asset' && assetKinds?.[src.params.asset]) return assetKinds[src.params.asset];
      // A source that may be several kinds (input.asset) counts as the one kind the role takes.
      const options = (Array.isArray(actual) ? actual : [actual]).map(strip);
      const allowed = Array.isArray(port.kind) ? port.kind.map(strip) : [strip(port.kind)];
      const both = options.filter(k => allowed.includes(k) || allowed.includes('any'));
      return both.length === 1 ? both[0] : options.length === 1 ? options[0] : undefined;
    }).filter(k => k && k !== 'any' && k !== 'json');
    const model = modelParam && models ? resolveModel(models, modelParam[1].kind, n.params[modelParam[0]] ?? modelParam[1].default, kinds, mode) : undefined;
    for (const [k, v] of Object.entries(n.params)) {
      const p = t.params[k];
      if (!p && modelParam) {
        // Params a node keeps for its model: judged against the catalog when it is given.
        if (!models) continue;
        const field = models.filter(m => m.kind === modelParam[1].kind).flatMap(m => m.fields).find(f => f.key === k);
        if (!field) { err('PARAM_UNKNOWN', `${n.type} has no param ${k}`, { nodeId: n.id, paramKey: k }); continue; }
        const own = model?.fields.find(f => f.key === k);
        const problem = own && fieldProblem(own, v);
        if (problem) err('PARAM_VALUE', problem, { nodeId: n.id, paramKey: k });
        continue;
      }
      if (!p) { err('PARAM_UNKNOWN', `${n.type} has no param ${k}`, { nodeId: n.id, paramKey: k }); continue; }
      if (p.type === 'model') {
        const ok = typeof v === 'string' && (!models || v === 'auto' || models.some(m => m.key === v && m.kind === p.kind));
        if (!ok) err('PARAM_VALUE', `${n.type}.${k}: ${JSON.stringify(v)} is not a ${p.kind} model`, { nodeId: n.id, paramKey: k });
        continue;
      }
      const bad = (
        (p.type === 'enum'    && !p.options.map(o => typeof o === 'string' ? o : o.value).includes(v)) ||
        (p.type === 'number'  && (typeof v !== 'number' || !Number.isFinite(v) || (p.step != null && Math.abs((v - (p.min ?? 0)) / p.step - Math.round((v - (p.min ?? 0)) / p.step)) > 1e-8) || (p.min != null && v < p.min) || (p.max != null && v > p.max))) ||
        (p.type === 'string'  && typeof v !== 'string') ||
        (p.type === 'boolean' && typeof v !== 'boolean') ||
        (p.type === 'asset'   && typeof v !== 'string') ||
        (p.type === 'json' && !ajv.validate(p.schema, v)) ||
        (p.type === 'color'   && !/^#[0-9a-fA-F]{6}$/.test(String(v)))
      );
      if (bad) err('PARAM_VALUE', `${n.type}.${k}: ${JSON.stringify(v)} is not valid`, { nodeId: n.id, paramKey: k });
    }
    for (const [k, p] of Object.entries(t.params))
      if (p.required && n.params[k] == null && p.default == null) err('PARAM_REQUIRED', `${n.type}.${k} is required`, { nodeId: n.id, paramKey: k });
    for (const p of t.inputs) {
      const incoming = recipe.edges.filter(e => e.target === n.id && e.targetPort === p.key);
      if (p.required && inMode(p, mode) && !incoming.length)
        err('INPUT_REQUIRED', `${n.id}: input ${p.label ?? p.key} is not connected`, { nodeId: n.id });
      if (incoming.length && !inMode(p, mode))
        for (const e of incoming) err('MODE', `${p.label ?? p.key} is not used in this mode`, { nodeId: n.id, edgeId: e.id });
      if (p.max && incoming.length > p.max)
        err('FAN_IN', `${p.label ?? p.key} takes at most ${p.max} input${p.max === 1 ? '' : 's'}`, { nodeId: n.id });
    }
    const modeSpec = t.modes?.find(m => m.value === mode);
    if (t.modes && !modeSpec) err('MODE', `${n.type} has no mode ${mode}`, { nodeId: n.id, paramKey: 'mode' });
    if (modeSpec?.needs && !kinds.includes(modeSpec.needs))
      err('MODE', `${modeSpec.label} needs a ${modeSpec.needs} input`, { nodeId: n.id, paramKey: 'mode' });
    if (model) {
      if (mode && model.modes && !model.modes.includes(mode))
        err('MODEL', `${model.title} can't do ${modeSpec?.label ?? mode}`, { nodeId: n.id, paramKey: modelParam[0] });
      for (const problem of inputProblems(model, kinds)) err('MODEL', problem, { nodeId: n.id, paramKey: modelParam[0] });
    } else if (modelParam && models)
      err('MODEL', `No ${modelParam[1].kind} model is available`, { nodeId: n.id, paramKey: modelParam[0] });
    // @ tokens must point to something connected to this node.
    if (typeof n.params.prompt === 'string')
      for (const ref of promptRefs(n.params.prompt)) {
        const linked = recipe.edges.some(e => e.target === n.id && (ref.scheme === 'node'
          ? e.source === ref.id
          : nodes.get(e.source)?.type === 'input.asset' && nodes.get(e.source)?.params.asset === ref.id));
        if (!linked) err('REFERENCE', `@${ref.label} is not connected any more`, { nodeId: n.id, paramKey: 'prompt' });
      }
  }

  // 8. groupId points to an existing group
  for (const n of recipe.nodes)
    if (n.groupId && !groups.has(n.groupId)) err('GROUP', `${n.id}: group ${n.groupId} does not exist`, { nodeId: n.id });

  // 9. meta.version is an integer >= 0 — enforced by the schema.
  return issues;
}

/**
 * Template rules for a recipe that carries meta.template (call after validate passes the schema).
 * Kept apart from validate so a canvas created from a template can still delete or change
 * the nodes its template once named. Returns Issue[] with code SCHEMA.
 */
export function validateTemplate(recipe, registry) {
  const issues = [];
  const template = recipe?.meta?.template;
  if (!template) return issues;
  const nodes = new Map(recipe.nodes.map(n => [n.id, n]));
  const seen = new Set();
  template.inputs.forEach((input, i) => {
    const where = { nodeId: input.nodeId, paramKey: input.paramKey };
    const node = nodes.get(input.nodeId);
    const type = node && registry.get(node.type);
    if (!node) issues.push({ code: 'SCHEMA', severity: 'error', message: `/meta/template/inputs/${i} names missing node ${input.nodeId}`, ...where });
    else if (type && !type.params[input.paramKey]) issues.push({ code: 'SCHEMA', severity: 'error', message: `/meta/template/inputs/${i}: ${node.type} has no param ${input.paramKey}`, ...where });
    const key = `${input.nodeId}.${input.paramKey}`;
    if (seen.has(key)) issues.push({ code: 'SCHEMA', severity: 'error', message: `/meta/template/inputs/${i} repeats ${key}`, ...where });
    seen.add(key);
  });
  return issues;
}

export function checkModelEntry(entry) {
  return modelSchema(entry) ? [] : modelSchema.errors.map(e => `${e.instancePath} ${e.message}`);
}

export function checkRegistryEntry(entry) {
  return registrySchema(entry) ? [] : registrySchema.errors.map(e => `${e.instancePath} ${e.message}`);
}
