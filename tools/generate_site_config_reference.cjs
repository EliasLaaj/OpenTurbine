const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'data_src', 'config.html');
const outputPath = path.join(root, 'site', '_includes', 'generated-config-fields.html');
const source = fs.readFileSync(sourcePath, 'utf8');

function matchingClose(text, openAt, openChar, closeChar) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = openAt; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === openChar) depth += 1;
    else if (char === closeChar && --depth === 0) return i;
  }
  throw new Error(`No matching ${closeChar} after offset ${openAt}`);
}

function topLevelObjects(text, arrayOpen, arrayClose) {
  const objects = [];
  let cursor = arrayOpen + 1;
  while (cursor < arrayClose) {
    const open = text.indexOf('{', cursor);
    if (open < 0 || open >= arrayClose) break;
    const close = matchingClose(text, open, '{', '}');
    objects.push(text.slice(open, close + 1));
    cursor = close + 1;
  }
  return objects;
}

function stringProperty(objectText, name) {
  const match = objectText.match(new RegExp(`\\b${name}\\s*:\\s*'((?:\\\\.|[^'])*)'`, 's'));
  return match ? match[1].replace(/\\'/g, "'") : '';
}

function html(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

const schemaAt = source.indexOf('const ALL_CONFIG_SCHEMA');
if (schemaAt < 0) throw new Error('Shared Controllers/System schema was not found');
const schemaOpen = source.indexOf('[', schemaAt);
const schemaClose = matchingClose(source, schemaOpen, '[', ']');
const sections = topLevelObjects(source, schemaOpen, schemaClose).map(sectionText => {
  const title = stringProperty(sectionText, 'title');
  const fieldsAt = sectionText.indexOf('fields:');
  if (!title || fieldsAt < 0) return null;
  const fieldsOpen = sectionText.indexOf('[', fieldsAt);
  const fieldsClose = matchingClose(sectionText, fieldsOpen, '[', ']');
  const fields = topLevelObjects(sectionText, fieldsOpen, fieldsClose).map(fieldText => ({
    key: stringProperty(fieldText, 'key'),
    label: stringProperty(fieldText, 'label'),
    description: stringProperty(fieldText, 'desc') || 'This field is hardware- or mode-specific. Use the information button beside it and leave it unchanged until its prerequisite is fitted and tested.',
    unit: stringProperty(fieldText, 'unit')
  })).filter(field => field.key && field.label);
  return { title, fields };
}).filter(Boolean);

const fieldCount = sections.reduce((sum, section) => sum + section.fields.length, 0);
const body = sections.map(section => `
<details class="reference-section">
  <summary>${html(section.title)} <span>${section.fields.length} fields</span></summary>
  <div class="table-wrap"><table>
    <thead><tr><th>Dashboard field</th><th>What it controls</th></tr></thead>
    <tbody>${section.fields.map(field => `<tr><td><strong>${html(field.label)}</strong>${field.unit ? ` <span class="quiet">(${html(field.unit)})</span>` : ''}</td><td>${html(field.description)}</td></tr>`).join('')}</tbody>
  </table></div>
</details>`).join('\n');

const output = `<!-- Generated from the shared Controllers/System schema by tools/generate_site_config_reference.cjs. Do not edit by hand. -->
<p class="source-note"><strong>${fieldCount} fields in ${sections.length} sections.</strong> This reference is generated from the same schema that renders the ECU Controllers and System pages, so names and explanations match the current code.</p>
${body}
`;

fs.writeFileSync(outputPath, output, 'utf8');
console.log(`Wrote ${fieldCount} fields in ${sections.length} sections to ${path.relative(root, outputPath)}`);
