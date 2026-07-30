const Ajv = require('/home/abdul-rahim/tazama/tms-service/node_modules/ajv');
const fs = require('fs');

const S = '/home/abdul-rahim/tazama/tms-service/src/schemas/';
const D = '/home/abdul-rahim/mojaloop/docs/Tazama/message mapping/samples/';

// exact options from tms-service/src/clients/fastify.ts
const ajv = new Ajv({ removeAdditional: 'all', useDefaults: true, coerceTypes: 'array', strictTuples: false, strict: false });

for (const [schemaFile, sampleFile] of [['pacs.008.json','tazama_pacs008.json'], ['pacs.002.json','tazama_pacs002.json']]) {
  const schema = JSON.parse(fs.readFileSync(S + schemaFile));
  const before = JSON.parse(fs.readFileSync(D + sampleFile));
  const payload = JSON.parse(JSON.stringify(before));
  const validate = ajv.compile(schema);
  const ok = validate(payload);
  console.log('='.repeat(68));
  console.log(`${sampleFile}  vs  ${schemaFile}`);
  console.log('='.repeat(68));
  console.log('  VALID:', ok);
  if (!ok) for (const e of validate.errors) console.log('   ERROR', e.instancePath, e.message);

  // what did removeAdditional strip?
  const stripped = [];
  (function diff(a, b, p) {
    for (const k of Object.keys(a)) {
      if (!(k in b)) { stripped.push(p + '.' + k); continue; }
      if (a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) diff(a[k], b[k], p + '.' + k);
    }
  })(before, payload, '');
  console.log('  STRIPPED by removeAdditional:', stripped.length ? stripped.join(', ') : '(nothing)');
  console.log();
}
