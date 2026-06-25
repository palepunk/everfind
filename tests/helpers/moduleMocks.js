const Module = require('module');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');

const purgeProjectModules = () => {
  for (const cacheKey of Object.keys(require.cache)) {
    if (cacheKey.startsWith(projectRoot) && !cacheKey.includes(`${path.sep}node_modules${path.sep}`)) {
      delete require.cache[cacheKey];
    }
  }
};

const loadWithMocks = (targetModule, mocks) => {
  purgeProjectModules();
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(targetModule);
  } finally {
    Module._load = originalLoad;
  }
};

module.exports = {
  loadWithMocks,
  purgeProjectModules,
};
