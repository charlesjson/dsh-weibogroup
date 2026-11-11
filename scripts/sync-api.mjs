#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!process.argv[2]) throw Error('Usage: npm run sync-api -- /path/to/weibogroup')
const sourceRoot = resolve(process.argv[2])
const render = `
const fs=require('node:fs'),Fastify=require('fastify'),swagger=require('@fastify/swagger');
const {createOpenApiOptions}=require('./src/viewer/openapi.ts');
const {aiV1Contracts,resolveQueryRouteContract}=require('./src/viewer/contracts/v1/routes.ts');
const {registerContractRoute}=require('./src/viewer/contracts/common.ts');
(async()=>{const app=Fastify();await app.register(swagger,createOpenApiOptions());
for(const contract of aiV1Contracts)registerContractRoute(app,resolveQueryRouteContract('external',contract),{},async()=>({}));
await app.ready();process.stdout.write(JSON.stringify(app.swagger(),null,2)+'\\n');await app.close()})().catch(e=>{console.error(e.message);process.exitCode=1});`
const document = execFileSync(process.execPath, ['--import', 'tsx'], { cwd: sourceRoot, input: render, encoding: 'utf8' })
JSON.parse(document)
await mkdir(resolve(projectRoot, 'src/contracts'), { recursive: true })
await writeFile(resolve(projectRoot, 'src/contracts/openapi.json'), document)
const files = { 'src/mcp/openapi-tools.ts': 'openapi-tools.ts', 'src/mcp/http-tools.ts': 'http-tools.ts', 'src/http/bounded-fetch.ts': 'bounded-fetch.ts', 'src/http/image-payload.ts': 'image-payload.ts' }
const hashes = {}
for (const [source, target] of Object.entries(files)) {
  const original = await readFile(resolve(sourceRoot, source), 'utf8')
  hashes[source] = createHash('sha256').update(original).digest('hex')
  await writeFile(resolve(projectRoot, 'src/vendor', target), original.replaceAll("'../utils/helpers.js'", "'./helpers.js'"))
}
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim()
const dirty = execFileSync('git', ['status', '--porcelain', '--', ...Object.keys(files), 'src/viewer/contracts', 'src/viewer/openapi.ts'], { cwd: sourceRoot, encoding: 'utf8' }).trim().length > 0
await writeFile(resolve(projectRoot, 'vendor-provenance.json'), JSON.stringify({ project: 'weibogroup', license: 'ISC', revision, dirty,
  openapiSha256: createHash('sha256').update(document).digest('hex'), files: hashes }, null, 2) + '\n')
console.log(`Synced API contract and ${Object.keys(files).length} shared modules from ${revision}${dirty ? ' (working changes)' : ''}`)
