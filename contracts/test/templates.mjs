import { validate, validateTemplate } from '../validate.mjs';
import { loadRegistry, loadTemplates } from '../node.mjs';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const reg = loadRegistry(new URL('../examples/registry/', import.meta.url).pathname);
const pilot = JSON.parse(readFileSync(new URL('../examples/pilot.recipe.json', import.meta.url)));
const template = () => {
  const r = structuredClone(pilot);
  r.meta.template = {
    title: 'Character short', description: 'Prompt to a voiced clip.', cover: 'ast_0f9b1c2e-1d2a-4b7a-9a34-0a0b0c0d0e0f',
    tags: ['video', 'pilot'], inputs: [{ nodeId: 'n_prompt', paramKey: 'text', label: 'Scene', help: 'Describe the character.' }],
  };
  return r;
};
let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n     ', e.message); process.exitCode = 1; } };
const codes = r => [...validate(r, reg), ...validateTemplate(r, reg)].map(i => i.code);

t('template: recipe without meta.template stays valid', () => assert.deepEqual(codes(pilot), []));
t('template: valid meta.template passes', () => assert.deepEqual(codes(template()), []));
t('template: only title and inputs are required', () => { const r = template(); r.meta.template = { title: 'Bare', inputs: [] }; assert.deepEqual(codes(r), []); });
t('template: unknown field inside meta.template rejected', () => { const r = template(); r.meta.template.author = 'x'; assert.ok(codes(r).includes('SCHEMA')); });
t('template: unknown field inside an input rejected', () => { const r = template(); r.meta.template.inputs[0].default = 'x'; assert.ok(codes(r).includes('SCHEMA')); });
t('template: title, tag and input limits', () => {
  for (const change of [
    r => { r.meta.template.title = ''; },
    r => { r.meta.template.title = 'x'.repeat(121); },
    r => { r.meta.template.description = 'x'.repeat(501); },
    r => { r.meta.template.tags = Array.from({ length: 11 }, (_, i) => `t${i}`); },
    r => { r.meta.template.tags = ['x'.repeat(31)]; },
    r => { r.meta.template.inputs = Array.from({ length: 21 }, () => ({ nodeId: 'n_prompt', paramKey: 'text' })); },
    r => { r.meta.template.cover = 'not-an-asset'; },
  ]) { const r = template(); change(r); assert.ok(codes(r).includes('SCHEMA'), JSON.stringify(r.meta.template).slice(0, 80)); }
});
t('template: input naming a missing node rejected', () => { const r = template(); r.meta.template.inputs[0].nodeId = 'n_gone'; assert.ok(validateTemplate(r, reg).some(i => i.code === 'SCHEMA' && i.nodeId === 'n_gone')); });
t('template: input naming a missing param rejected', () => { const r = template(); r.meta.template.inputs[0].paramKey = 'nope'; assert.ok(validateTemplate(r, reg).some(i => i.paramKey === 'nope')); });
t('template: repeated input rejected', () => { const r = template(); r.meta.template.inputs.push({ nodeId: 'n_prompt', paramKey: 'text' }); assert.equal(validateTemplate(r, reg).length, 1); });
t('template: validate itself ignores template inputs', () => { const r = template(); r.meta.template.inputs[0].nodeId = 'n_gone'; assert.deepEqual(validate(r, reg), []); });

const builtIns = loadTemplates(new URL('../examples/templates/', import.meta.url).pathname);
for (const builtIn of builtIns)
  t(`built-in ${builtIn.slug}: validates against the registry with meta.template`, () => {
    assert.ok(builtIn.recipe.meta.template, 'meta.template is required');
    const issues = [...validate(builtIn.recipe, reg), ...validateTemplate(builtIn.recipe, reg)]
      .filter(i => !['PARAM_REQUIRED', 'INPUT_REQUIRED'].includes(i.code));
    assert.deepEqual(issues, []);
  });
console.log(`\n${pass} passed (${builtIns.length} built-in templates)`);
