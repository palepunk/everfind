const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

const projectRoot = path.resolve(__dirname, '..');
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    request = path.join(projectRoot, request.slice(2));
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const compileWithBabel = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const result = babel.transformSync(source, {
    filename,
    presets: [require.resolve('babel-preset-expo')],
    babelrc: false,
    configFile: false,
    sourceMaps: 'inline',
  });

  module._compile(result ? result.code : source, filename);
};

Module._extensions['.ts'] = compileWithBabel;
Module._extensions['.tsx'] = compileWithBabel;
