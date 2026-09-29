// validate.mjs — registry/v1 + recipe/v1 schema check and the 9 recipe invariants.
// Pure module: no UI, no server. Same code runs on client and server.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import registryDefinition from './schemas/registry.schema.json' with { type: 'json' };
import recipeDefinition from './schemas/recipe.schema.json' with { type: 'json' };

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const registrySchema = ajv.compile(registryDefinition);
const recipeSchema = ajv.compile(recipeDefinition);

// --- kinds ---------------------------------------------------------------
const isList = k => typeof k === 'string' && k.startsWith('list<');
const inner  = k => k.slice(5, -1);
const accepts = (declared, actual) => {
  // declared: port kind (string or array of kinds); actual: a concrete kind string
  const opts = Array.isArray(declared) ? declared : [declared];
  const kinds = Array.isArray(actual) ? actual : [actual];
  return opts.some(d => d === 'any' || kinds.some(k => k === 'any' || d === k));
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
      let k = p.kind === 'any' ? (anyIn ?? 'any') : p.kind;
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
