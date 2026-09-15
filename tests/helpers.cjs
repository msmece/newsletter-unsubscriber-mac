/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { readFileSync } = require('node:fs')
const { resolve, dirname } = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(path, globals = {}, mocks = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText
  const context = {
    exports: {},
    URL,
    Date,
    Response,
    AbortSignal,
    Buffer,
    setTimeout,
    clearTimeout,
    require: (name) => {
      if (name in mocks) return mocks[name]
      if (name === 'electron') return { shell: {} }
      if (name.startsWith('.')) return load(resolve(dirname(path), name + '.ts'), globals, mocks)
      return require(name)
    },
    ...globals
  }
  vm.runInNewContext(code, context)
  return context.exports
}
module.exports = { load }
