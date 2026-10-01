# Built-in templates

Each built-in template is a recipe/v1 file whose `meta.template` is set, plus an optional cover:

```
<slug>.recipe.json   recipe with meta.template { title, description?, tags?, inputs[] }
<slug>.cover.png     optional cover image, served by GET /templates/<id>/cover
```

`<slug>` uses lowercase letters, digits and `-`. The template id is `tpl_builtin_<slug>` with `-` replaced by `_`.

The API seeds every file here on startup (`INSERT … ON CONFLICT DO UPDATE`), so edits reach existing databases. Built-ins are read-only in the app; leave `meta.template.cover` unset, since built-in covers come from the PNG next to the recipe.

`pnpm test` validates every file against the current registry and checks that each `meta.template.inputs[]` entry names a real node and param.

The set is intentionally empty for now.
