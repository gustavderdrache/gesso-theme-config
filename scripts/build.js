// @ts-check

const del = require('del');
const globby = require('globby');
const { get } = require('lodash');
const makeDir = require('make-dir');
const YAML = require('yaml');
const path = require('path');
const fs = require('fs');
const util = require('util');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

// Glob all the *.yml files in 'src/'. Use the filename (without the .yml part) as
// the name in the
async function getSourceData() {
  const sourcePath = path.join(__dirname, '../src');

  const sources = await globby('*.yml', { cwd: sourcePath });

  /** @type {*} */
  const sourceData = {};
  for (const source of sources) {
    const srcPath = path.join(sourcePath, source);
    const key = path.basename(source, '.yml');

    sourceData[key] = YAML.parse(await readFile(path.join(srcPath), 'utf-8'));
  }

  return sourceData;
}

/**
 * @param {string} key
 * @param {*} data
 */
function lookupRoot(key, data) {
  const value = get(data, key);
  if (value === undefined) {
    throw new Error(`Failed to discover ${key} in configuration.`);
  }

  return value;
}

/**
 * Performs a lookup at the root.
 *
 * @param {string} prefix
 * @return {(key: string, data: *) => *}
 */
function createLookup(prefix) {
  return (key, data) => lookupRoot(prefix + '.' + key, data);
}

/**
 * Finds a theme color by name, e.g. `text.primary` or `background.secondary`.
 */
const lookupThemeColor = createLookup('theme.color');

/**
 * Creates a lookup function that starts looking for values in the `theme.typography`
 * object.
 *
 * @param {string} key
 */
function createTypographyLookup(key) {
  return createLookup('theme.typography.' + key);
}

const lookupFontFamily = createTypographyLookup('font-family');
const lookupFontWeight = createTypographyLookup('font-weight');
const lookupLineHeight = createTypographyLookup('line-height');
const lookupFontSize = createTypographyLookup('font-size');

/**
 * Resolves color values from `theme.*` or `grayscale.*` lookups.
 *
 * @param {{ theme: { color: Record<string, any>; }; }} root
 */
function transformColorData(root) {
  /**
   * @param {Record.<string, *>} data
   */
  function transformColorWalker(data) {
    for (const key of Object.keys(data)) {
      const value = data[key];
      if (typeof value === 'string') {
        data[key] = lookupRoot(value, root);
      } else {
        transformColorWalker(data[key]);
      }
    }
  }

  transformColorWalker(root.theme.color);
}

// This is both a transformating mapping and CSS property whitelist for text display
// properties
const displayTransformMap = new Map([
  ['font-family', lookupFontFamily],
  ['font-weight', lookupFontWeight],
  ['font-size', lookupFontSize],
  ['color', lookupThemeColor],
  ['line-height', lookupLineHeight],
  ['letter-spacing', null],
]);

function transformDisplayData(root) {
  const display = root.theme.typography.display;

  for (const record of Object.values(display)) {
    for (const [key, value] of Object.entries(record)) {
      if (!displayTransformMap.has(key)) {
        throw new Error(`Unexpected key ${key} in display setting`);
      }

      // If lookup is null, then it's merely an allowed value
      const lookup = displayTransformMap.get(key);
      if (lookup !== null) {
        record[key] = lookup(value, root);
      }
    }
  }
}

/**
 * Resolves color and typography references.
 *
 * @param {*} data
 */
function transformData(data) {
  transformColorData(data);
  transformDisplayData(data);
}

const sassOutputDirectory = path.join(__dirname, '../sass');

/**
 * Deletes and regenerates the `sass/` directory.
 */
async function prepareOutputDirectory() {
  await del(sassOutputDirectory);
  await makeDir(sassOutputDirectory);
}

/**
 * Prepares a JS value for output as a Sass value.
 *
 * @param {unknown} value
 */
function cleanValue(value) {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value !== 'string') {
    throw new TypeError(
      `Value passed to cleanValue() is ${typeof value}, not a string or number`,
    );
  }

  if (!value.includes(' ')) {
    return value;
  }

  return value.includes("'") ? '"' + value + '"' : "'" + value + "'";
}

/**
 * Creates a Sass map from a JS object.
 *
 * @param {*} data
 * @param {number} indent
 */
function createSassMap(data, indent = 2) {
  let output = '';
  const prefix = ' '.repeat(indent);

  output += '(\n';
  for (const [key, value] of Object.entries(data)) {
    output += `${prefix}${key}: `;
    switch (typeof value) {
      case 'number':
      case 'string':
        output += cleanValue(value);
        break;

      default:
        output += createSassMap(value, indent + 2);
        break;
    }

    output += ',\n';
  }
  output += ' '.repeat(indent - 2) + ')';

  return output;
}

/**
 * Creates Sass variables from top-level data objects. The keys will be used as variable
 * names, and the values will be converted into Sass maps.
 *
 * @param {*} root
 */
function createSassVariables(root) {
  let output = '';

  for (const [key, value] of Object.entries(root)) {
    output += '$' + key + ': ';
    output += createSassMap(value);
    output += ';\n';
  }

  return output;
}

async function main() {
  const sourceData = await getSourceData();

  transformData(sourceData);

  await prepareOutputDirectory();

  await writeFile(
    path.join(sassOutputDirectory, 'variables.scss'),
    createSassVariables(sourceData),
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
