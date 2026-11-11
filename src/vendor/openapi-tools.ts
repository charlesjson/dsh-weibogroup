import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import type { JsonSchemaValidator } from '@modelcontextprotocol/sdk/validation';
import { isRecord } from './helpers.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type HttpMethodName = (typeof HTTP_METHODS)[number];
export type McpHttpMethod = Uppercase<HttpMethodName>;
export type McpArgumentLocation = 'path' | 'query' | 'body';

export interface McpArgumentBinding {
  name: string;
  location: McpArgumentLocation;
  required: boolean;
  style?: string;
  explode?: boolean;
}

export interface McpToolOperation {
  name: string;
  method: McpHttpMethod;
  routePath: string;
  arguments: readonly McpArgumentBinding[];
  hasRequestBody: boolean;
  tool: Tool;
  validateArguments: JsonSchemaValidator<Record<string, unknown>>;
  validateOutput?: JsonSchemaValidator<Record<string, unknown>>;
}

export interface McpToolCatalog {
  tools: Tool[];
  operations: ReadonlyMap<string, McpToolOperation>;
}

export class McpCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpCatalogError';
  }
}

interface ParsedParameter {
  key: string;
  binding: McpArgumentBinding;
  schema: Record<string, unknown>;
}

function contextError(context: string, message: string): McpCatalogError {
  return new McpCatalogError(`${context}: ${message}`);
}

function assertSafeMcpRoutePath(routePath: string): void {
  const unsafe = (message: string): never => {
    throw new McpCatalogError(`unsafe MCP route path ${routePath}: ${message}`);
  };
  if (/[\\%?#\u0000-\u001F\u007F]/u.test(routePath)) unsafe('contains URL-control characters');
  const segments = routePath.split('/').slice(1);
  if (segments.length < 3 || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    unsafe('contains an empty or dot path segment');
  }
  for (const segment of segments) {
    const staticPart = segment.replace(/\{[A-Za-z0-9_-]+\}/g, '');
    if (/[{}]/u.test(staticPart) || !/^[A-Za-z0-9._~!$&'()*+,;=:@-]*$/u.test(staticPart)) {
      unsafe(`contains an unsupported path segment: ${segment}`);
    }
  }
}

function nonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function decodeJsonPointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function lookupLocalReference(root: unknown, reference: string, context: string): unknown {
  if (!reference.startsWith('#/')) {
    throw contextError(context, `only local OpenAPI references are supported, received ${reference}`);
  }
  let current: unknown = root;
  for (const encodedToken of reference.slice(2).split('/')) {
    const token = decodeJsonPointerToken(encodedToken);
    if (!isRecord(current) || !Object.hasOwn(current, token)) {
      throw contextError(context, `OpenAPI reference does not exist: ${reference}`);
    }
    current = current[token];
  }
  return current;
}

function resolveOpenApiNode(
  root: unknown,
  value: unknown,
  context: string,
  referenceStack: readonly string[] = [],
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => resolveOpenApiNode(root, item, `${context}[${index}]`, referenceStack));
  }
  if (!isRecord(value)) return value;

  const reference = nonBlankString(value.$ref);
  if (reference) {
    if (referenceStack.includes(reference)) {
      throw contextError(context, `cyclic OpenAPI reference detected: ${[...referenceStack, reference].join(' -> ')}`);
    }
    const target = resolveOpenApiNode(
      root,
      lookupLocalReference(root, reference, context),
      context,
      [...referenceStack, reference],
    );
    if (!isRecord(target)) {
      throw contextError(context, `OpenAPI reference must resolve to an object: ${reference}`);
    }
    const siblings = Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '$ref')
        .map(([key, child]) => [key, resolveOpenApiNode(root, child, `${context}.${key}`, referenceStack)]),
    );
    return { ...target, ...siblings };
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      resolveOpenApiNode(root, child, `${context}.${key}`, referenceStack),
    ]),
  );
}

function normalizeJsonSchema(value: unknown, context: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeJsonSchema(item, `${context}[${index}]`));
  }
  if (!isRecord(value)) return value;

  const normalizedEntries = Object.entries(value)
    .filter(([key]) => key !== 'nullable')
    .map(([key, child]) => [key, normalizeJsonSchema(child, `${context}.${key}`)] as const);
  const normalized = Object.fromEntries(normalizedEntries);

  if (value.nullable !== true) return normalized;
  if (Object.keys(normalized).length === 0) return { type: ['null', 'object'] };
  return { anyOf: [normalized, { type: 'null' }] };
}

function resolveSchema(root: unknown, value: unknown, context: string): Record<string, unknown> {
  const resolved = resolveOpenApiNode(root, value, context);
  const normalized = normalizeJsonSchema(resolved, context);
  if (!isRecord(normalized)) throw contextError(context, 'schema must be an object');
  return normalized;
}

function schemaWithDescription(
  schema: Record<string, unknown>,
  description: unknown,
): Record<string, unknown> {
  const normalizedDescription = nonBlankString(description);
  if (!normalizedDescription || nonBlankString(schema.description)) return schema;
  return { ...schema, description: normalizedDescription };
}

function assertSerializableParameterSchema(
  schema: Record<string, unknown>,
  location: 'path' | 'query',
  name: string,
  context: string,
): void {
  const scalarTypes = new Set(['string', 'integer', 'number', 'boolean']);
  if (typeof schema.type === 'string' && scalarTypes.has(schema.type)) return;
  if (location === 'query' && schema.type === 'array' && isRecord(schema.items)) {
    if (typeof schema.items.type === 'string' && scalarTypes.has(schema.items.type)) return;
  }
  throw contextError(context, `${location} parameter ${name} must use a scalar schema or a scalar array`);
}

function parseParameter(root: unknown, raw: unknown, context: string): ParsedParameter {
  const resolved = resolveOpenApiNode(root, raw, context);
  if (!isRecord(resolved)) throw contextError(context, 'parameter must be an object');

  const name = nonBlankString(resolved.name);
  if (!name) throw contextError(context, 'parameter name is required');
  const location = resolved.in;
  if (location !== 'path' && location !== 'query') {
    throw contextError(context, `unsupported parameter location for ${name}: ${String(location)}`);
  }
  const required = location === 'path' || resolved.required === true;
  if (location === 'path' && resolved.required !== true) {
    throw contextError(context, `path parameter ${name} must set required=true`);
  }
  if (resolved.allowReserved !== undefined) {
    if (location !== 'query') {
      throw contextError(context, 'allowReserved is only valid for query parameters');
    }
    if (typeof resolved.allowReserved !== 'boolean') {
      throw contextError(context, 'allowReserved must be a boolean');
    }
    if (resolved.allowReserved) {
      throw contextError(context, 'allowReserved=true is unsupported');
    }
  }

  const schema = schemaWithDescription(
    resolveSchema(root, resolved.schema, `${context}.schema`),
    resolved.description,
  );
  assertSerializableParameterSchema(schema, location, name, context);
  const style = nonBlankString(resolved.style);
  const explode = typeof resolved.explode === 'boolean' ? resolved.explode : undefined;
  if (location === 'path' && style && style !== 'simple') {
    throw contextError(context, `unsupported path serialization style for ${name}: ${style}`);
  }
  if (location === 'query' && style && style !== 'form') {
    throw contextError(context, `unsupported query serialization style for ${name}: ${style}`);
  }

  return {
    key: `${location}\u0000${name}`,
    binding: { name, location, required, ...(style ? { style } : {}), ...(explode === undefined ? {} : { explode }) },
    schema,
  };
}

function parameterList(value: unknown, context: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw contextError(context, 'parameters must be an array');
  return value;
}

function mergeParameters(
  root: unknown,
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
  context: string,
): ParsedParameter[] {
  const merged = new Map<string, ParsedParameter>();
  for (const [source, rawParameters] of [
    ['path', parameterList(pathItem.parameters, `${context}.path.parameters`)],
    ['operation', parameterList(operation.parameters, `${context}.parameters`)],
  ] as const) {
    const sourceKeys = new Set<string>();
    rawParameters.forEach((raw, index) => {
      const parameter = parseParameter(root, raw, `${context}.${source}.parameters[${index}]`);
      if (sourceKeys.has(parameter.key)) {
        throw contextError(
          `${context}.${source}.parameters[${index}]`,
          `duplicate ${parameter.binding.location} parameter: ${parameter.binding.name}`,
        );
      }
      sourceKeys.add(parameter.key);
      merged.set(parameter.key, parameter);
    });
  }
  return [...merged.values()];
}

function requestBodySchema(
  root: unknown,
  operation: Record<string, unknown>,
  context: string,
): { properties: Record<string, Record<string, unknown>>; required: Set<string> } | undefined {
  if (operation.requestBody === undefined) return undefined;
  const requestBody = resolveOpenApiNode(root, operation.requestBody, `${context}.requestBody`);
  if (!isRecord(requestBody) || !isRecord(requestBody.content)) {
    throw contextError(context, 'requestBody.content is required');
  }
  const media = requestBody.content['application/json'];
  if (!isRecord(media) || media.schema === undefined) {
    throw contextError(context, 'only application/json request bodies are supported');
  }
  const schema = resolveSchema(root, media.schema, `${context}.requestBody.schema`);
  if (schema.type !== 'object' || !isRecord(schema.properties)) {
    throw contextError(context, 'JSON request body schema must be an object with explicit properties');
  }

  const properties: Record<string, Record<string, unknown>> = {};
  for (const [name, propertySchema] of Object.entries(schema.properties)) {
    properties[name] = resolveSchema(root, propertySchema, `${context}.requestBody.properties.${name}`);
  }
  const requiredValues = schema.required === undefined ? [] : schema.required;
  if (!Array.isArray(requiredValues) || !requiredValues.every((name): name is string => typeof name === 'string')) {
    throw contextError(context, 'requestBody.required must be a string array');
  }
  for (const name of requiredValues) {
    if (!Object.hasOwn(properties, name)) {
      throw contextError(context, `requestBody.required references unknown property ${name}`);
    }
  }
  return { properties, required: new Set(requiredValues) };
}

function responseSchema(
  root: unknown,
  operation: Record<string, unknown>,
  context: string,
): Tool['outputSchema'] | undefined {
  if (!isRecord(operation.responses)) return undefined;
  const successfulStatus = Object.keys(operation.responses)
    .filter((status) => /^2\d\d$/.test(status))
    .sort()[0];
  if (!successfulStatus) return undefined;
  const response = resolveOpenApiNode(root, operation.responses[successfulStatus], `${context}.responses.${successfulStatus}`);
  if (!isRecord(response) || !isRecord(response.content)) return undefined;
  const media = response.content['application/json'];
  if (!isRecord(media) || media.schema === undefined) return undefined;
  const schema = resolveSchema(root, media.schema, `${context}.responses.${successfulStatus}.schema`);
  if (schema.type !== 'object') {
    throw contextError(context, 'JSON success response schema must have type=object for MCP structured output');
  }
  return schema as Tool['outputSchema'];
}

function operationDescription(operation: Record<string, unknown>, operationId: string): string {
  const summary = nonBlankString(operation.summary);
  const description = nonBlankString(operation.description);
  if (summary && description && summary !== description) return `${summary}\n\n${description}`;
  return summary ?? description ?? operationId;
}

function validatePathBindings(routePath: string, bindings: readonly McpArgumentBinding[], context: string): void {
  const placeholders = [...routePath.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
  const pathParameters = bindings.filter((binding) => binding.location === 'path').map((binding) => binding.name);
  const missing = placeholders.filter((name) => !pathParameters.includes(name));
  const unused = pathParameters.filter((name) => !placeholders.includes(name));
  if (missing.length > 0 || unused.length > 0) {
    throw contextError(
      context,
      `path placeholders and parameters differ (missing: ${missing.join(', ') || 'none'}; unused: ${unused.join(', ') || 'none'})`,
    );
  }
}

function buildOperation(
  root: unknown,
  routePath: string,
  pathItem: Record<string, unknown>,
  method: HttpMethodName,
  operation: Record<string, unknown>,
  validatorProvider: AjvJsonSchemaValidator,
): McpToolOperation {
  const context = `${method.toUpperCase()} ${routePath}`;
  const operationId = nonBlankString(operation.operationId);
  if (!operationId) throw contextError(context, 'operationId is required');
  if (!TOOL_NAME_PATTERN.test(operationId)) {
    throw contextError(context, `operationId is not a valid MCP tool name: ${operationId}`);
  }

  const properties: Record<string, object> = {};
  const required = new Set<string>();
  const bindings: McpArgumentBinding[] = [];
  for (const parameter of mergeParameters(root, pathItem, operation, context)) {
    if (Object.hasOwn(properties, parameter.binding.name)) {
      throw contextError(context, `flattened argument name collides: ${parameter.binding.name}`);
    }
    properties[parameter.binding.name] = parameter.schema;
    bindings.push(parameter.binding);
    if (parameter.binding.required) required.add(parameter.binding.name);
  }

  const body = requestBodySchema(root, operation, context);
  if (body) {
    for (const [name, schema] of Object.entries(body.properties)) {
      if (Object.hasOwn(properties, name)) {
        throw contextError(context, `flattened path/query/body argument name collides: ${name}`);
      }
      properties[name] = schema;
      const isRequired = body.required.has(name);
      bindings.push({ name, location: 'body', required: isRequired });
      if (isRequired) required.add(name);
    }
  }
  validatePathBindings(routePath, bindings, context);

  const inputSchema: Tool['inputSchema'] = {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.size > 0 ? { required: [...required] } : {}),
  };
  const summary = nonBlankString(operation.summary);
  const outputSchema = responseSchema(root, operation, context);
  // POST batch reads opt in explicitly; HTTP method alone cannot describe side effects.
  const isWrite = operation['x-mcp-read-only'] !== true
    && (method === 'post' || method === 'put' || method === 'patch' || method === 'delete');
  const tool: Tool = {
    name: operationId,
    ...(summary ? { title: summary } : {}),
    description: operationDescription(operation, operationId),
    inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
    ...(operation['x-weibogroup-capability'] === 'export' ? { _meta: { 'weibogroup/capability': 'export' } } : {}),
    annotations: {
      ...(summary ? { title: summary } : {}),
      readOnlyHint: !isWrite,
      destructiveHint: operation['x-mcp-destructive'] === true,
      idempotentHint: !isWrite,
      openWorldHint: false,
    },
  };

  return {
    name: operationId,
    method: method.toUpperCase() as McpHttpMethod,
    routePath,
    arguments: bindings,
    hasRequestBody: body !== undefined,
    tool,
    validateArguments: validatorProvider.getValidator<Record<string, unknown>>(inputSchema),
    ...(outputSchema ? {
      validateOutput: validatorProvider.getValidator<Record<string, unknown>>(outputSchema),
    } : {}),
  };
}

export function buildMcpToolCatalog(document: unknown): McpToolCatalog {
  if (!isRecord(document) || !isRecord(document.paths)) {
    throw new McpCatalogError('OpenAPI document must contain a paths object');
  }

  const validatorProvider = new AjvJsonSchemaValidator();
  const tools: Tool[] = [];
  const operations = new Map<string, McpToolOperation>();
  for (const [routePath, rawPathItem] of Object.entries(document.paths)) {
    if (!routePath.startsWith('/api/v1/')) continue;
    assertSafeMcpRoutePath(routePath);
    const pathContext = `PATH ${routePath}`;
    const pathItem = resolveOpenApiNode(document, rawPathItem, pathContext);
    if (!isRecord(pathItem)) throw contextError(pathContext, 'Path Item must be an object');
    for (const method of HTTP_METHODS) {
      const rawOperation = pathItem[method];
      if (rawOperation === undefined) continue;
      if (!isRecord(rawOperation)) throw contextError(`${method.toUpperCase()} ${routePath}`, 'operation must be an object');
      if (rawOperation['x-mcp-enabled'] === false) continue;
      const built = buildOperation(document, routePath, pathItem, method, rawOperation, validatorProvider);
      if (operations.has(built.name)) throw contextError(built.name, 'operationId must be unique');
      operations.set(built.name, built);
      tools.push(built.tool);
    }
  }
  if (tools.length === 0) throw new McpCatalogError('OpenAPI document contains no /api/v1 operations');
  return { tools, operations };
}
