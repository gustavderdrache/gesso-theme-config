// @ts-check

'use strict';

const { iterate } = require('nani');
const path = require('path');
const yaml = require('yaml');

const readSource = require('./lib/readSource');
const transform = require('./lib/transform');

async function main() {
  const parsed = await readSource(path.join(__dirname, '../src/gesso.yml'));

  const transformed = transform(parsed);

  console.log(yaml.stringify(transformed.data));
}

main().catch(error => {
  for (const err of iterate(error)) {
    if (err && err.info) {
      console.error(err.message);
      console.error(err.info.source + '\n');
    }
  }

  process.exitCode = 1;
});
