'use strict';

const PROTOCOL_VERSION = 2;
const MODULE_CATEGORY_ROUTES = Object.freeze({
    'global-memory': 'planner',
    'continuity': 'planner',
    'knowledge-boundary': 'planner',
    'character-state': 'planner',
    'relationship-state': 'planner',
    'scene-state': 'planner',
    'cross-module-consistency': 'planner',
    'style': 'main',
    'format': 'main',
    'language': 'main',
    'pov': 'main',
    'length': 'main',
    'local-rp': 'main',
    'output-template': 'main',
    'context-evidence': 'context',
});
const COVERAGE_STATUS_BY_ROUTE = Object.freeze({
    planner: 'compiled',
    main: 'preserved',
    context: 'observed',
});
const EVIDENCE_KINDS = new Set([
    'fact',
    'memory',
    'knowledge-boundary',
    'character-state',
    'relationship-state',
    'scene-state',
]);
const CONSTRAINT_KINDS = new Set([
    'global-memory',
    'continuity',
    'knowledge-boundary',
    'character',
    'character-state',
    'relationship',
    'relationship-state',
    'scene',
    'scene-state',
    'cross-module-consistency',
    'safety',
    'other',
]);
const CERTAINTIES = new Set(['confirmed', 'inferred', 'uncertain']);
const CONSTRAINT_STRENGTHS = new Set(['hard', 'soft']);
const REASONING_EFFORTS = new Set(['', 'low', 'medium', 'high']);
const STRUCTURED_OUTPUT_MODES = new Set(['none', 'json_object', 'tool_call']);
const SUPPORT_PACKET_TOOL_NAME = 'submit_support_packet';
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const SOURCE_REF_PATTERN = /^(message:\d+|module:[A-Za-z0-9._:-]+|state:[A-Za-z0-9._:-]+)$/;
const MAX_JOB_BYTES = 8 * 1024 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MODULES = 128;
const MAX_MODULE_INSTRUCTION_LENGTH = 16 * 1024;
const MAX_ITEMS_PER_FIELD = 96;
const MAX_TEXT_LENGTH = 1600;
const MAX_REFS_PER_ITEM = 16;
const MAX_PACKET_LENGTH = 24 * 1024;

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}

class ProviderError extends Error {
    constructor(message, status = 502, retryable = false) {
        super(message);
        this.name = 'ProviderError';
        this.status = status;
        this.retryable = retryable;
    }
}

class PlannerTimeoutError extends Error {
    constructor() {
        super('Planner provider request timed out.');
        this.name = 'PlannerTimeoutError';
    }
}

class PlannerCancelledError extends Error {
    constructor() {
        super('Planner request was cancelled.');
        this.name = 'PlannerCancelledError';
    }
}

function clampInteger(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
}

function assertPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ValidationError(`${label} must be an object.`);
    }
}

function assertExactKeys(value, expectedKeys, label) {
    const actual = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new ValidationError(`${label} has unexpected or missing fields.`);
    }
}

function normalizeId(value, label) {
    const id = String(value ?? '').trim();
    if (!ID_PATTERN.test(id)) {
        throw new ValidationError(`${label} is invalid.`);
    }
    return id;
}

function normalizeText(value, label, maximum = MAX_TEXT_LENGTH) {
    if (typeof value !== 'string') {
        throw new ValidationError(`${label} must be a string.`);
    }
    const text = value.trim();
    if (!text || text.length > maximum) {
        throw new ValidationError(`${label} must contain 1-${maximum} characters.`);
    }
    return text;
}

function canonicalize(value) {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function fnv1a64(value) {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= BigInt(value.charCodeAt(index));
        hash = BigInt.asUintN(64, hash * prime);
    }
    return hash.toString(16).padStart(16, '0');
}

function computeContextHash(job) {
    const hashInput = JSON.parse(JSON.stringify({
        context: job.context,
        cot: job.cot,
        state: job.state,
    }));
    return `fnv1a64:${fnv1a64(canonicalize(hashInput))}`;
}

function normalizeProviderEndpoint(baseUrl) {
    let url;
    try {
        url = new URL(String(baseUrl ?? '').trim());
    } catch {
        throw new ValidationError('Planner base URL is invalid.');
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new ValidationError('Planner base URL must use HTTP or HTTPS.');
    }
    if (url.username || url.password) {
        throw new ValidationError('Planner base URL must not contain credentials.');
    }

    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    if (!url.pathname.endsWith('/chat/completions')) {
        url.pathname = `${url.pathname}/chat/completions`.replace(/\/+/g, '/');
    }

    return url.toString();
}

function validateConfig(value) {
    assertPlainObject(value, 'Planner config');
    const model = String(value.model ?? '').trim();
    if (!model || model.length > 200) {
        throw new ValidationError('Planner model is required and must be at most 200 characters.');
    }

    const reasoningEffort = String(value.reasoningEffort ?? '').trim().toLowerCase();
    if (!REASONING_EFFORTS.has(reasoningEffort)) {
        throw new ValidationError('Planner reasoning effort is unsupported.');
    }
    const legacyStructuredOutput = value.structuredOutput !== false ? 'json_object' : 'none';
    const structuredOutputMode = String(value.structuredOutputMode ?? legacyStructuredOutput).trim();
    if (!STRUCTURED_OUTPUT_MODES.has(structuredOutputMode)) {
        throw new ValidationError('Planner structured output mode is unsupported.');
    }

    return {
        endpoint: normalizeProviderEndpoint(value.baseUrl),
        model,
        maxTokens: clampInteger(value.maxTokens, 64, 8192, 1200),
        temperature: clampNumber(value.temperature, 0, 2, 0.2),
        timeoutMs: clampInteger(value.timeoutMs, 1000, 120000, 45000),
        retryCount: clampInteger(value.retryCount, 0, 3, 1),
        structuredOutputMode,
        reasoningEffort,
    };
}

function validateModules(value) {
    if (!Array.isArray(value) || value.length > MAX_MODULES) {
        throw new ValidationError(`Planner COT modules must be an array with at most ${MAX_MODULES} items.`);
    }

    const ids = new Set();
    return value.map((module, index) => {
        assertPlainObject(module, `COT module ${index}`);
        const id = normalizeId(module.id, `COT module ${index} id`);
        if (ids.has(id)) throw new ValidationError(`Duplicate COT module id '${id}'.`);
        ids.add(id);

        const category = String(module.category ?? '').trim();
        const route = MODULE_CATEGORY_ROUTES[category];
        if (!route || module.route !== route) {
            throw new ValidationError(`COT module '${id}' has an invalid category route.`);
        }
        const removable = module.removable === true;
        if (removable && route !== 'planner') {
            throw new ValidationError(`Only planner-routed module '${id}' may be removable.`);
        }

        return {
            id,
            label: normalizeText(module.label, `COT module '${id}' label`, 240),
            category,
            route,
            instruction: normalizeText(module.instruction, `COT module '${id}' instruction`, MAX_MODULE_INSTRUCTION_LENGTH),
            sourceRef: normalizeText(module.sourceRef, `COT module '${id}' sourceRef`, 240),
            removable,
        };
    });
}

function validateJob(value) {
    assertPlainObject(value, 'Planner job');
    if (value.protocolVersion !== PROTOCOL_VERSION) {
        throw new ValidationError('Planner job protocol version is unsupported.');
    }

    const requestId = String(value.requestId ?? '');
    if (!requestId || requestId.length > 200) {
        throw new ValidationError('Planner request ID is invalid.');
    }
    assertPlainObject(value.context, 'Planner context');
    if (!Array.isArray(value.context.messages) || value.context.messages.length > 1000) {
        throw new ValidationError('Planner context messages are invalid.');
    }
    assertPlainObject(value.cot, 'Planner COT descriptor');
    assertPlainObject(value.state, 'Planner state descriptor');
    assertPlainObject(value.state.providers, 'Planner state providers');

    const job = {
        protocolVersion: PROTOCOL_VERSION,
        requestId,
        generationType: String(value.generationType ?? 'normal'),
        contextHash: String(value.contextHash ?? ''),
        context: value.context,
        cot: {
            source: String(value.cot.source ?? ''),
            modules: validateModules(value.cot.modules),
        },
        state: value.state,
    };
    if (job.contextHash !== computeContextHash(job)) {
        throw new ValidationError('Planner job context hash is invalid.');
    }

    const serialized = JSON.stringify(job);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_JOB_BYTES) {
        throw new ValidationError('Planner job exceeds the maximum request size.');
    }
    return job;
}

function validSourceRefsForJob(job) {
    const refs = new Set(job.context.messages.map((_, index) => `message:${index}`));
    for (const module of job.cot.modules) refs.add(`module:${module.id}`);
    for (const providerId of Object.keys(job.state.providers)) refs.add(`state:${providerId}`);
    return refs;
}

function normalizeSourceRefs(value, label, validRefs) {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REFS_PER_ITEM) {
        throw new ValidationError(`${label} must contain 1-${MAX_REFS_PER_ITEM} source references.`);
    }
    const refs = value.map((entry, index) => {
        const ref = String(entry ?? '').trim();
        if (!SOURCE_REF_PATTERN.test(ref) || !validRefs.has(ref)) {
            throw new ValidationError(`${label} item ${index} references unknown source '${ref}'.`);
        }
        return ref;
    });
    return [...new Set(refs)];
}

function normalizeRecordArray(value, field, normalizeRecord) {
    if (!Array.isArray(value) || value.length > MAX_ITEMS_PER_FIELD) {
        throw new ValidationError(`Support packet field '${field}' is invalid or too large.`);
    }
    const ids = new Set();
    return value.map((record, index) => {
        assertPlainObject(record, `Support packet '${field}' item ${index}`);
        const normalized = normalizeRecord(record, index);
        if (ids.has(normalized.id)) {
            throw new ValidationError(`Duplicate support packet id '${normalized.id}' in '${field}'.`);
        }
        ids.add(normalized.id);
        return normalized;
    });
}

function normalizeCoverage(value, job) {
    if (!Array.isArray(value) || value.length !== job.cot.modules.length) {
        throw new ValidationError('Support packet module coverage is incomplete.');
    }
    const expected = new Map(job.cot.modules.map(module => [module.id, module]));
    const seen = new Set();
    return value.map((record, index) => {
        assertPlainObject(record, `Module coverage item ${index}`);
        assertExactKeys(record, ['moduleId', 'route', 'status'], `Module coverage item ${index}`);
        const moduleId = normalizeId(record.moduleId, `Module coverage item ${index} moduleId`);
        const module = expected.get(moduleId);
        if (!module || seen.has(moduleId)) {
            throw new ValidationError(`Unexpected or duplicate module coverage '${moduleId}'.`);
        }
        seen.add(moduleId);
        const status = COVERAGE_STATUS_BY_ROUTE[module.route];
        if (record.route !== module.route || record.status !== status) {
            throw new ValidationError(`Module coverage mismatch for '${moduleId}'.`);
        }
        return { moduleId, route: module.route, status };
    });
}

function validateSupportPacket(value, job) {
    assertPlainObject(value, 'Support packet');
    assertExactKeys(
        value,
        ['moduleCoverage', 'evidence', 'constraints', 'conflicts', 'uncertainties'],
        'Support packet',
    );
    const validRefs = validSourceRefsForJob(job);
    const packet = {
        moduleCoverage: normalizeCoverage(value.moduleCoverage, job),
        evidence: normalizeRecordArray(value.evidence, 'evidence', (record, index) => {
            assertExactKeys(record, ['id', 'kind', 'text', 'sourceRefs', 'certainty'], `Evidence item ${index}`);
            const kind = String(record.kind ?? '');
            const certainty = String(record.certainty ?? '');
            if (!EVIDENCE_KINDS.has(kind) || !CERTAINTIES.has(certainty)) {
                throw new ValidationError(`Evidence item ${index} has invalid metadata.`);
            }
            return {
                id: normalizeId(record.id, `Evidence item ${index} id`),
                kind,
                text: normalizeText(record.text, `Evidence item ${index} text`),
                sourceRefs: normalizeSourceRefs(record.sourceRefs, `Evidence item ${index} sourceRefs`, validRefs),
                certainty,
            };
        }),
        constraints: normalizeRecordArray(value.constraints, 'constraints', (record, index) => {
            assertExactKeys(record, ['id', 'kind', 'text', 'sourceRefs', 'strength'], `Constraint item ${index}`);
            const kind = String(record.kind ?? '');
            const normalizedKind = CONSTRAINT_KINDS.has(kind) ? kind : 'other';
            const strength = String(record.strength ?? '');
            if (!CONSTRAINT_STRENGTHS.has(strength)) {
                const safeKind = kind.slice(0, 80).replace(/[\r\n]/g, ' ');
                const safeStrength = strength.slice(0, 80).replace(/[\r\n]/g, ' ');
                throw new ValidationError(
                    `Constraint item ${index} has invalid metadata (kind=${JSON.stringify(safeKind)}, strength=${JSON.stringify(safeStrength)}).`,
                );
            }
            return {
                id: normalizeId(record.id, `Constraint item ${index} id`),
                kind: normalizedKind,
                text: normalizeText(record.text, `Constraint item ${index} text`),
                sourceRefs: normalizeSourceRefs(record.sourceRefs, `Constraint item ${index} sourceRefs`, validRefs),
                strength,
            };
        }),
        conflicts: normalizeRecordArray(value.conflicts, 'conflicts', (record, index) => {
            assertExactKeys(record, ['id', 'text', 'sourceRefs'], `Conflict item ${index}`);
            return {
                id: normalizeId(record.id, `Conflict item ${index} id`),
                text: normalizeText(record.text, `Conflict item ${index} text`),
                sourceRefs: normalizeSourceRefs(record.sourceRefs, `Conflict item ${index} sourceRefs`, validRefs),
            };
        }),
        uncertainties: normalizeRecordArray(value.uncertainties, 'uncertainties', (record, index) => {
            assertExactKeys(record, ['id', 'text', 'sourceRefs'], `Uncertainty item ${index}`);
            return {
                id: normalizeId(record.id, `Uncertainty item ${index} id`),
                text: normalizeText(record.text, `Uncertainty item ${index} text`),
                sourceRefs: normalizeSourceRefs(record.sourceRefs, `Uncertainty item ${index} sourceRefs`, validRefs),
            };
        }),
    };
    if (JSON.stringify(packet).length > MAX_PACKET_LENGTH) {
        throw new ValidationError('Support packet exceeds the maximum serialized size.');
    }
    return packet;
}

function buildPlannerMessages(job) {
    const coverage = job.cot.modules.map(module => ({
        moduleId: module.id,
        route: module.route,
        status: COVERAGE_STATUS_BY_ROUTE[module.route],
    }));
    const system = [
        'You are a private subordinate constraint compiler for a separate roleplay writer model.',
        'Execute only modules whose route is planner. Main-routed modules remain direct writer instructions; do not rewrite or execute them. Context-routed modules are evidence only.',
        'Never write prose, dialogue, exact actions, mandatory plot beats, a draft, or an assistant prefill.',
        'Return only one JSON object with exactly these keys: moduleCoverage, evidence, constraints, conflicts, uncertainties.',
        `Return moduleCoverage exactly as supplied: ${JSON.stringify(coverage)}`,
        'Every evidence, constraint, conflict, and uncertainty item must have a unique ASCII id, concise text, and one or more valid sourceRefs.',
        'Valid sourceRefs use message:<index>, module:<id>, or state:<provider-id>. Never invent a source reference.',
        'Evidence kinds: fact, memory, knowledge-boundary, character-state, relationship-state, scene-state.',
        'Evidence certainty: confirmed, inferred, uncertain. Never label an inference confirmed.',
        'Constraint kinds: global-memory, continuity, knowledge-boundary, character, character-state, relationship, relationship-state, scene, scene-state, cross-module-consistency, safety, other. Constraint strength: hard or soft.',
        'Keep the packet compact: at most 24 evidence items, 24 constraints, 8 conflicts, and 8 uncertainties.',
        'Use empty arrays when there is no sourced content. Do not include markdown or commentary outside JSON.',
    ].join('\n');

    const indexedMessages = job.context.messages.map((message, index) => ({
        sourceRef: `message:${index}`,
        ...message,
    }));
    const user = JSON.stringify({
        requestId: job.requestId,
        contextHash: job.contextHash,
        generationType: job.generationType,
        context: { ...job.context, messages: indexedMessages },
        cot: job.cot,
        state: job.state,
    });

    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

function buildProviderPayload(job, config) {
    const payload = {
        model: config.model,
        messages: buildPlannerMessages(job),
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: false,
    };
    if (config.structuredOutputMode === 'json_object') {
        payload.response_format = { type: 'json_object' };
    }
    if (config.structuredOutputMode === 'tool_call') {
        payload.tools = [{
            type: 'function',
            function: {
                name: SUPPORT_PACKET_TOOL_NAME,
                description: 'Submit the complete validated support packet for the writer model.',
                parameters: supportPacketToolSchema(),
            },
        }];
        payload.tool_choice = {
            type: 'function',
            function: { name: SUPPORT_PACKET_TOOL_NAME },
        };
    }
    if (config.reasoningEffort) payload.reasoning_effort = config.reasoningEffort;
    return payload;
}

function supportPacketToolSchema() {
    const sourceRefs = {
        type: 'array',
        minItems: 1,
        maxItems: MAX_REFS_PER_ITEM,
        items: { type: 'string', pattern: SOURCE_REF_PATTERN.source },
    };
    const id = { type: 'string', pattern: ID_PATTERN.source };
    const text = { type: 'string', minLength: 1, maxLength: MAX_TEXT_LENGTH };
    return {
        type: 'object',
        additionalProperties: false,
        properties: {
            moduleCoverage: {
                type: 'array',
                maxItems: MAX_MODULES,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        moduleId: id,
                        route: { type: 'string', enum: ['planner', 'main', 'context'] },
                        status: { type: 'string', enum: ['compiled', 'preserved', 'observed'] },
                    },
                    required: ['moduleId', 'route', 'status'],
                },
            },
            evidence: {
                type: 'array',
                maxItems: MAX_ITEMS_PER_FIELD,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        id,
                        kind: { type: 'string', enum: [...EVIDENCE_KINDS] },
                        text,
                        sourceRefs,
                        certainty: { type: 'string', enum: [...CERTAINTIES] },
                    },
                    required: ['id', 'kind', 'text', 'sourceRefs', 'certainty'],
                },
            },
            constraints: {
                type: 'array',
                maxItems: MAX_ITEMS_PER_FIELD,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        id,
                        kind: { type: 'string', enum: [...CONSTRAINT_KINDS] },
                        text,
                        sourceRefs,
                        strength: { type: 'string', enum: [...CONSTRAINT_STRENGTHS] },
                    },
                    required: ['id', 'kind', 'text', 'sourceRefs', 'strength'],
                },
            },
            conflicts: {
                type: 'array',
                maxItems: MAX_ITEMS_PER_FIELD,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { id, text, sourceRefs },
                    required: ['id', 'text', 'sourceRefs'],
                },
            },
            uncertainties: {
                type: 'array',
                maxItems: MAX_ITEMS_PER_FIELD,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { id, text, sourceRefs },
                    required: ['id', 'text', 'sourceRefs'],
                },
            },
        },
        required: ['moduleCoverage', 'evidence', 'constraints', 'conflicts', 'uncertainties'],
    };
}

function extractMessageContent(providerResponse) {
    const content = providerResponse?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (content && typeof content === 'object' && !Array.isArray(content)) return JSON.stringify(content);
    if (Array.isArray(content)) {
        return content
            .map(part => typeof part === 'string' ? part : part?.text)
            .filter(text => typeof text === 'string')
            .join('');
    }
    throw new ProviderError('Planner provider returned no message content.');
}

function extractProviderContent(providerResponse, config) {
    if (config.structuredOutputMode !== 'tool_call') return extractMessageContent(providerResponse);
    const toolCalls = providerResponse?.choices?.[0]?.message?.tool_calls;
    const call = Array.isArray(toolCalls)
        ? toolCalls.find(item => item?.function?.name === SUPPORT_PACKET_TOOL_NAME)
        : null;
    const argumentsText = call?.function?.arguments;
    if (typeof argumentsText !== 'string' || !argumentsText.trim()) {
        throw new ProviderError('Planner provider returned no support-packet tool call.');
    }
    return argumentsText;
}

function jsonObjectCandidates(content) {
    const trimmed = String(content).trim();
    const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const candidates = [unfenced];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < unfenced.length; index += 1) {
        const character = unfenced[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') inString = false;
            continue;
        }
        if (character === '"') {
            inString = true;
            continue;
        }
        if (character === '{') {
            if (depth === 0) start = index;
            depth += 1;
            continue;
        }
        if (character === '}' && depth > 0) {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                candidates.push(unfenced.slice(start, index + 1));
                start = -1;
            }
        }
    }

    return [...new Set(candidates.filter(Boolean))];
}

function parsePlannerContent(content, job) {
    let parsed;
    for (const candidate of jsonObjectCandidates(content)) {
        try {
            parsed = JSON.parse(candidate);
            break;
        } catch {
            // Try the next complete object when the provider added surrounding commentary.
        }
    }
    if (parsed === undefined) throw new ProviderError('Planner provider returned invalid JSON.');
    try {
        return validateSupportPacket(parsed, job);
    } catch (error) {
        throw new ProviderError(`Planner provider returned an invalid support packet: ${error.message}`);
    }
}

async function fetchProviderResponse(fetchImpl, url, options, timeoutMs, externalSignal) {
    if (externalSignal?.aborted) throw new PlannerCancelledError();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    const cancel = () => controller.abort();
    externalSignal?.addEventListener('abort', cancel, { once: true });

    try {
        const response = await fetchImpl(url, { ...options, signal: controller.signal });
        const text = await readProviderResponse(response);
        return { response, text };
    } catch (error) {
        if (timedOut) throw new PlannerTimeoutError();
        if (externalSignal?.aborted) throw new PlannerCancelledError();
        throw error;
    } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', cancel);
    }
}

function shouldRetryStatus(status) {
    return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function waitForRetry(milliseconds, signal) {
    if (signal?.aborted) throw new PlannerCancelledError();
    if (!signal) {
        await new Promise(resolve => setTimeout(resolve, milliseconds));
        return;
    }
    await new Promise((resolve, reject) => {
        const finish = () => {
            signal.removeEventListener('abort', cancel);
            resolve();
        };
        const timeout = setTimeout(finish, milliseconds);
        const cancel = () => {
            clearTimeout(timeout);
            signal.removeEventListener('abort', cancel);
            reject(new PlannerCancelledError());
        };
        signal.addEventListener('abort', cancel, { once: true });
    });
}

async function readProviderResponse(response) {
    const declaredLength = Number(response.headers?.get?.('content-length')) || 0;
    if (declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new ProviderError('Planner provider response is too large.');
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new ProviderError('Planner provider response is too large.');
    }
    return text;
}

function safeProviderError(text, status) {
    let detail = '';
    try {
        const parsed = JSON.parse(text);
        detail = String(parsed?.error?.message ?? parsed?.message ?? '').trim();
    } catch {
        detail = '';
    }
    const suffix = detail ? `: ${detail.slice(0, 300)}` : '';
    return new ProviderError(`Planner provider returned HTTP ${status}${suffix}`, status, shouldRetryStatus(status));
}

async function executePlanner({ job: rawJob, config: rawConfig, apiKey, signal, fetchImpl = fetch }) {
    const job = validateJob(rawJob);
    const config = validateConfig(rawConfig);
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
        throw new ValidationError('Planner API key is not configured on the server.');
    }

    const providerPayload = buildProviderPayload(job, config);
    let lastError;
    for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
        try {
            const { response, text: responseText } = await fetchProviderResponse(fetchImpl, config.endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(providerPayload),
            }, config.timeoutMs, signal);

            if (!response.ok) throw safeProviderError(responseText, response.status);
            let providerResponse;
            try {
                providerResponse = JSON.parse(responseText);
            } catch {
                throw new ProviderError('Planner provider returned an invalid response envelope.');
            }

            const content = extractProviderContent(providerResponse, config);
            let packet;
            try {
                packet = parsePlannerContent(content, job);
            } catch (error) {
                if (error instanceof ProviderError && error.message === 'Planner provider returned invalid JSON.') {
                    const finishReason = String(providerResponse?.choices?.[0]?.finish_reason ?? 'unknown');
                    const detail = finishReason === 'length'
                        ? ' The provider stopped at its output token limit.'
                        : ` Finish reason: ${finishReason}.`;
                    throw new ProviderError(`${error.message}${detail} Output characters: ${content.length}.`);
                }
                throw error;
            }
            return {
                protocolVersion: PROTOCOL_VERSION,
                requestId: job.requestId,
                contextHash: job.contextHash,
                packet,
                meta: { model: config.model, attempts: attempt + 1 },
            };
        } catch (error) {
            lastError = error;
            if (error instanceof PlannerCancelledError) throw error;
            const retryable = error instanceof PlannerTimeoutError
                || error instanceof TypeError
                || error?.retryable === true;
            if (!retryable || attempt >= config.retryCount) throw error;
            await waitForRetry(250 * (2 ** attempt), signal);
        }
    }
    throw lastError ?? new ProviderError('Planner provider request failed.');
}

module.exports = {
    PROTOCOL_VERSION,
    MODULE_CATEGORY_ROUTES,
    PlannerCancelledError,
    PlannerTimeoutError,
    ProviderError,
    ValidationError,
    buildPlannerMessages,
    buildProviderPayload,
    computeContextHash,
    executePlanner,
    extractMessageContent,
    extractProviderContent,
    normalizeProviderEndpoint,
    parsePlannerContent,
    validateConfig,
    validateJob,
    validateSupportPacket,
};
