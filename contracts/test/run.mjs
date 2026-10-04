import { validate, checkRegistryEntry } from '../validate.mjs';
import { loadRegistry, loadModels } from '../node.mjs';
import { migrateRecipe } from '../migrate.ts';
import { parsePrompt, promptRefs, renderPrompt, refToken } from '../prompt.ts';
import { resolveModel, inputProblems, modelParams } from '../models.ts';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const reg = loadRegistry(new URL('../examples/registry/', import.meta.url).pathname);
const pilot = JSON.parse(readFileSync(new URL('../examples/pilot.recipe.json', import.meta.url)));
const models = loadModels(new URL('../models/', import.meta.url).pathname);
const clone = () => structuredClone(pilot);
let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n     ', e.message); process.exitCode = 1; } };
const codes = r => validate(r, reg, models).map(i => i.code);

t('registry: 9 types load and pass registry/v1', () => assert.equal(reg.size, 9));
t('models: catalog loads, one default per kind', () => { assert.equal(models.length, 4); for (const k of ['llm', 'image', 'video', 'audio']) assert.equal(models.filter(m => m.kind === k && m.default).length, 1); });
t('pilot recipe passes recipe/v1 + all invariants', () => assert.deepEqual(codes(pilot), []));
t('inv 1: duplicate id', () => { const r = clone(); r.edges[0].id = 'n_img'; assert.ok(codes(r).includes('DUP_ID')); });
t('inv 2: unknown type', () => { const r = clone(); r.nodes[0].type = 'text.nope'; assert.ok(codes(r).includes('UNKNOWN_TYPE')); });
t('inv 2: old typeVersion without migrate', () => { const r = clone(); r.nodes[1].typeVersion = 9; assert.ok(codes(r).includes('VERSION')); });
t('inv 3: edge to missing port', () => { const r = clone(); r.edges[0].targetPort = 'nope'; assert.ok(codes(r).includes('EDGE_PORT')); });
t('inv 4: kind mismatch text -> image', () => { const r = clone(); r.edges.push({ id: 'e_bad', source: 'n_prompt', sourcePort: 'text', target: 'n_vid', targetPort: 'prompt' }); r.edges.push({ id: 'e_bad2', source: 'n_voice', sourcePort: 'audio', target: 'n_edit', targetPort: 'instruction' }); assert.ok(codes(r).includes('KIND')); });
t('inv 4: fan-out list<image> -> image is allowed', () => assert.deepEqual(codes(pilot), []));
t('inv 4: any passes the real kind through flow.if', () => { const r = clone(); r.edges.find(e => e.id === 'e_4').targetPort = 'prompt'; assert.ok(codes(r).includes('KIND'), 'image into a text port must fail even through any'); });
t('inv 5: two edges into one non-multiple input', () => { const r = clone(); r.edges.push({ id: 'e_dup', source: 'n_if', sourcePort: 'then', target: 'n_vid', targetPort: 'first' }); assert.ok(codes(r).includes('FAN_IN')); });
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

// --- model catalog, modes, roles, prompt references (issue #25 contracts) ---
const video = (extra = {}) => ({ schema: 'recipe/v1', meta: { id: 'r', name: 'v', version: 1, registryVersion: 'x' }, groups: [],
  nodes: [
    { id: 'a1', type: 'input.asset', typeVersion: 1, position: { x: 0, y: 0 }, params: { asset: 'ast_1' } },
    { id: 'a2', type: 'input.asset', typeVersion: 1, position: { x: 0, y: 0 }, params: { asset: 'ast_2' } },
    { id: 'v', type: 'video.generate', typeVersion: 2, position: { x: 0, y: 0 }, params: { model: 'auto', mode: 'frames', prompt: 'go', ...extra } },
  ],
  edges: [{ id: 'e1', source: 'a1', sourcePort: 'asset', target: 'v', targetPort: 'first' }] });
t('model: unknown model key is a PARAM_VALUE', () => { const r = clone(); r.nodes[1].params.model = 'gpt-image-9'; assert.ok(codes(r).includes('PARAM_VALUE')); });
t('model: field out of the catalog range', () => assert.ok(codes(video({ duration: 40 })).includes('PARAM_VALUE')));
t('model: param no model has', () => assert.ok(codes(video({ seed: 7 })).includes('PARAM_UNKNOWN')));
t('model: without the catalog, model params are not judged', () => assert.deepEqual(validate(video({ duration: 40 }), reg).map(i => i.code), []));
t('mode: frames with a first frame passes', () => assert.deepEqual(codes(video()), []));
t('mode: a role the mode lacks is a MODE issue', () => { const r = video(); r.edges.push({ id: 'e2', source: 'a2', sourcePort: 'asset', target: 'v', targetPort: 'reference' }); assert.ok(codes(r).includes('MODE')); });
t('mode: first frame is required only in frames mode', () => { const r = video({ mode: 'text' }); r.edges = []; assert.deepEqual(codes(r), []); const f = video(); f.edges = []; assert.ok(codes(f).includes('INPUT_REQUIRED')); });
t('roles: last frame takes one input', () => { const r = video(); r.edges.push({ id: 'e2', source: 'a2', sourcePort: 'asset', target: 'v', targetPort: 'last' }, { id: 'e3', source: 'a1', sourcePort: 'asset', target: 'v', targetPort: 'last' }); assert.ok(codes(r).includes('FAN_IN')); });
t('model: too many references for the model', () => { const r = video({ mode: 'reference' }); r.edges = []; for (let i = 0; i < 10; i++) { r.nodes.push({ id: `x${i}`, type: 'input.asset', typeVersion: 1, position: { x: 0, y: 0 }, params: { asset: `ast_x${i}` } }); r.edges.push({ id: `ex${i}`, source: `x${i}`, sourcePort: 'asset', target: 'v', targetPort: 'reference' }); } const kinds = Object.fromEntries(r.nodes.map(n => [n.params.asset, 'image'])); assert.ok(validate(r, reg, models, kinds).some(i => i.code === 'MODEL')); assert.ok(!codes(r).includes('MODEL'), 'unknown asset kinds are not counted'); });
t('refs: @asset needs an input.asset node with an edge', () => { assert.deepEqual(codes(video({ prompt: 'Animate @[Logo](asset:ast_1)' })), []); assert.ok(codes(video({ prompt: 'Animate @[Gone](asset:ast_9)' })).includes('REFERENCE')); });
t('refs: @node needs an edge from that node', () => { assert.deepEqual(codes(video({ prompt: '@[Frame](node:a1) moves' })), []); assert.ok(codes(video({ prompt: '@[Other](node:a2) moves' })).includes('REFERENCE')); });
t('refs: parse, list once, render and keep labels display-only', () => {
  const text = `Put ${refToken({ scheme: 'asset', id: 'ast_1', label: 'Logo [v2]' })} on @[Bag](node:n_b) and @[Logo](asset:ast_1)`;
  assert.equal(parsePrompt(text).filter(p => p.type === 'ref').length, 3);
  assert.deepEqual(promptRefs(text).map(r => r.id), ['ast_1', 'n_b']);
  assert.equal(renderPrompt(text, { 'asset:ast_1': 'image 1' }), 'Put image 1 on @Bag and image 1');
});
t('migrate: v1 pilot becomes the v2 pilot', () => {
  const v1 = clone();
  const img = v1.nodes.find(n => n.id === 'n_img'); img.typeVersion = 1; img.params = { model: 'seedream-4', aspect: '9:16', count: 2, seed: 7 };
  const vid = v1.nodes.find(n => n.id === 'n_vid'); vid.typeVersion = 1; vid.params = { model: 'seedance-1.5', durationSec: 5 };
  const voice = v1.nodes.find(n => n.id === 'n_voice'); voice.typeVersion = 1; voice.params = { mode: 'voice', voice: 'nova' };
  v1.edges.find(e => e.id === 'e_4').targetPort = 'image';
  assert.deepEqual(migrateRecipe(v1), pilot);
  assert.equal(migrateRecipe(pilot), pilot, 'a current recipe is returned as is');
  // A template's inputs follow the renamed params; gone ones (seed, voice) are dropped.
  v1.meta = { ...v1.meta, template: { title: 'T', inputs: [
    { nodeId: 'n_vid', paramKey: 'durationSec' }, { nodeId: 'n_img', paramKey: 'aspect' }, { nodeId: 'n_img', paramKey: 'seed' },
    { nodeId: 'n_voice', paramKey: 'voice' }, { nodeId: 'n_prompt', paramKey: 'text' },
  ] } };
  assert.deepEqual(migrateRecipe(v1).meta.template.inputs.map(i => `${i.nodeId}.${i.paramKey}`), ['n_vid.duration', 'n_img.ratio', 'n_prompt.text']);
});
t('models: auto picks the default that fits, else another fitting model', () => {
  assert.equal(resolveModel(models, 'video', 'auto', ['image'], 'frames').key, 'seedance-2-5');
  assert.equal(resolveModel(models, 'image', 'seedream-5-pro').key, 'seedream-5-pro');
  assert.equal(resolveModel(models, 'image', 'nope'), undefined);
  assert.ok(inputProblems(models.find(m => m.key === 'seed-audio-1'), ['image']).length);
  assert.deepEqual(modelParams(models.find(m => m.key === 'seedance-2-5'), { duration: 8, junk: 1 }), { ratio: '16:9', resolution: '720p', duration: 8 });
});
t('text.generate: context takes any kind, many inputs', () => {
  const r = clone();
  r.nodes.push({ id: 'n_txt', type: 'text.generate', typeVersion: 1, position: { x: 0, y: 400 }, params: { prompt: 'Describe it', preset: 'describe' } });
  r.edges.push({ id: 'e_c1', source: 'n_prompt', sourcePort: 'text', target: 'n_txt', targetPort: 'context' }, { id: 'e_c2', source: 'n_edit', sourcePort: 'image', target: 'n_txt', targetPort: 'context' });
  assert.deepEqual(codes(r).filter(c => c !== 'NESTED_LIST'), []);
});
t('registry: seed is gone from image.generate', () => assert.equal(reg.get('image.generate').params.seed, undefined));
console.log(`\n${pass} passed`);
