export const PROTOCOL_VERSION = 2;
export const RUNTIME_MESSAGE_MARKER = '[yezi-reasoning-runtime:v2]';
export const WRITER_DIRECTIVES_MARKER = '[yezi-writer-directives:v1]';

export const MODULE_CATEGORY_ROUTES = Object.freeze({
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

export const SUPPORT_PACKET_KEYS = Object.freeze([
    'moduleCoverage',
    'evidence',
    'constraints',
    'conflicts',
    'uncertainties',
]);

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
    'continuity',
    'character',
    'relationship',
    'scene',
    'safety',
    'other',
]);
const CERTAINTIES = new Set(['confirmed', 'inferred', 'uncertain']);
const CONSTRAINT_STRENGTHS = new Set(['hard', 'soft']);
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const SOURCE_REF_PATTERN = /^(message:\d+|module:[A-Za-z0-9._:-]+|state:[A-Za-z0-9._:-]+)$/;
const MAX_MODULES = 128;
const MAX_MODULE_INSTRUCTION_LENGTH = 16 * 1024;
const MAX_ITEMS_PER_FIELD = 96;
const MAX_TEXT_LENGTH = 1600;
const MAX_REFS_PER_ITEM = 16;
const MAX_PACKET_LENGTH = 24 * 1024;

export function cloneMessages(messages) {
    if (!Array.isArray(messages)) {
        throw new TypeError('Finalized request messages must be an array.');
    }

    return structuredClone(messages);
}

export function createRequestId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function assertPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object.`);
    }
}

function assertExactKeys(value, expectedKeys, label) {
    const actual = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new TypeError(`${label} has unexpected or missing fields.`);
    }
}

function normalizeId(value, label) {
    const id = String(value ?? '').trim();
    if (!ID_PATTERN.test(id)) {
        throw new TypeError(`${label} must use letters, digits, dot, underscore, colon, or dash.`);
    }
    return id;
}

function normalizeText(value, label, maximum = MAX_TEXT_LENGTH) {
    if (typeof value !== 'string') {
        throw new TypeError(`${label} must be a string.`);
    }
    const text = value.trim();
    if (!text || text.length > maximum) {
        throw new RangeError(`${label} must contain 1-${maximum} characters.`);
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

export function normalizeCotModules(modules) {
    if (!Array.isArray(modules)) {
        throw new TypeError('COT modules must be an array.');
    }
    if (modules.length > MAX_MODULES) {
        throw new RangeError(`COT modules exceed the maximum of ${MAX_MODULES}.`);
    }

    const ids = new Set();
    return modules.map((value, index) => {
        assertPlainObject(value, `COT module ${index}`);
        const id = normalizeId(value.id, `COT module ${index} id`);
        if (ids.has(id)) {
            throw new TypeError(`Duplicate COT module id '${id}'.`);
        }
        ids.add(id);

        const category = String(value.category ?? '').trim();
        const route = MODULE_CATEGORY_ROUTES[category];
        if (!route) {
            throw new TypeError(`COT module '${id}' has an unknown category '${category}'.`);
        }

        const removable = value.removable === true;
        if (removable && route !== 'planner') {
            throw new TypeError(`Only planner-routed module '${id}' may be removable.`);
        }

        return {
            id,
            label: normalizeText(value.label, `COT module '${id}' label`, 240),
            category,
            route,
            instruction: normalizeText(
                value.instruction,
                `COT module '${id}' instruction`,
                MAX_MODULE_INSTRUCTION_LENGTH,
            ),
            sourceRef: normalizeText(value.sourceRef, `COT module '${id}' sourceRef`, 240),
            removable,
        };
    });
}

export function computeContextHash(job) {
    const hashInput = JSON.parse(JSON.stringify({
        context: job.context,
        cot: job.cot,
        state: job.state,
    }));
    return `fnv1a64:${fnv1a64(canonicalize(hashInput))}`;
}

export function buildPlannerJob(generateData, runtimeInput = {}) {
    const messages = cloneMessages(runtimeInput.contextMessages ?? generateData.messages);
    const modules = normalizeCotModules(runtimeInput.modules ?? []);
    const stateProviders = structuredClone(runtimeInput.stateProviders ?? {});
    assertPlainObject(stateProviders, 'State providers');

    const job = {
        protocolVersion: PROTOCOL_VERSION,
        requestId: createRequestId(),
        generationType: String(generateData.type ?? 'normal'),
        context: {
            messages,
            modelHints: {
                mainModel: String(generateData.model ?? ''),
                mainSource: String(generateData.chat_completion_source ?? ''),
            },
            tokenBudget: Number(generateData.max_tokens) || 0,
        },
        cot: {
            source: String(runtimeInput.cotSource ?? 'context-only-mvp'),
            modules,
        },
        state: {
            providers: stateProviders,
        },
    };
    job.contextHash = computeContextHash(job);
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
        throw new TypeError(`${label} must contain 1-${MAX_REFS_PER_ITEM} source references.`);
    }
    const refs = value.map((entry, index) => {
        const ref = String(entry ?? '').trim();
        if (!SOURCE_REF_PATTERN.test(ref) || !validRefs.has(ref)) {
            throw new TypeError(`${label} item ${index} references unknown source '${ref}'.`);
        }
        return ref;
    });
    return [...new Set(refs)];
}

function normalizeRecordArray(value, field, normalizeRecord) {
    if (!Array.isArray(value)) {
        throw new TypeError(`Support packet field '${field}' must be an array.`);
    }
    if (value.length > MAX_ITEMS_PER_FIELD) {
        throw new RangeError(`Support packet field '${field}' is too large.`);
    }
    const ids = new Set();
    return value.map((record, index) => {
        assertPlainObject(record, `Support packet '${field}' item ${index}`);
        const normalized = normalizeRecord(record, index);
        if (ids.has(normalized.id)) {
            throw new TypeError(`Duplicate support packet id '${normalized.id}' in '${field}'.`);
        }
        ids.add(normalized.id);
        return normalized;
    });
}

function normalizeCoverage(value, job) {
    if (!Array.isArray(value)) {
        throw new TypeError("Support packet field 'moduleCoverage' must be an array.");
    }
    if (value.length !== job.cot.modules.length) {
        throw new TypeError('Support packet module coverage is incomplete.');
    }

    const expected = new Map(job.cot.modules.map(module => [module.id, module]));
    const seen = new Set();
    const normalized = value.map((record, index) => {
        assertPlainObject(record, `Module coverage item ${index}`);
        assertExactKeys(record, ['moduleId', 'route', 'status'], `Module coverage item ${index}`);
        const moduleId = normalizeId(record.moduleId, `Module coverage item ${index} moduleId`);
        const module = expected.get(moduleId);
        if (!module || seen.has(moduleId)) {
            throw new TypeError(`Unexpected or duplicate module coverage '${moduleId}'.`);
        }
        seen.add(moduleId);
        if (record.route !== module.route) {
            throw new TypeError(`Module coverage route mismatch for '${moduleId}'.`);
        }
        const expectedStatus = COVERAGE_STATUS_BY_ROUTE[module.route];
        if (record.status !== expectedStatus) {
            throw new TypeError(`Module coverage status mismatch for '${moduleId}'.`);
        }
        return { moduleId, route: module.route, status: expectedStatus };
    });

    return normalized;
}

export function validateSupportPacket(value, job) {
    assertPlainObject(value, 'Support packet');
    assertExactKeys(value, SUPPORT_PACKET_KEYS, 'Support packet');
    const validRefs = validSourceRefsForJob(job);

    const packet = {
        moduleCoverage: normalizeCoverage(value.moduleCoverage, job),
        evidence: normalizeRecordArray(value.evidence, 'evidence', (record, index) => {
            assertExactKeys(record, ['id', 'kind', 'text', 'sourceRefs', 'certainty'], `Evidence item ${index}`);
            const kind = String(record.kind ?? '');
            const certainty = String(record.certainty ?? '');
            if (!EVIDENCE_KINDS.has(kind)) {
                throw new TypeError(`Evidence item ${index} has invalid kind '${kind}'.`);
            }
            if (!CERTAINTIES.has(certainty)) {
                throw new TypeError(`Evidence item ${index} has invalid certainty '${certainty}'.`);
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
            const strength = String(record.strength ?? '');
            if (!CONSTRAINT_KINDS.has(kind)) {
                throw new TypeError(`Constraint item ${index} has invalid kind '${kind}'.`);
            }
            if (!CONSTRAINT_STRENGTHS.has(strength)) {
                throw new TypeError(`Constraint item ${index} has invalid strength '${strength}'.`);
            }
            return {
                id: normalizeId(record.id, `Constraint item ${index} id`),
                kind,
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
        throw new RangeError('Support packet exceeds the maximum serialized size.');
    }
    return packet;
}

export function validatePlannerEnvelope(value, job) {
    assertPlainObject(value, 'Planner response');
    if (value.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error('Planner protocol version does not match.');
    }
    if (value.requestId !== job.requestId) {
        throw new Error('Planner response request ID does not match.');
    }
    if (value.contextHash !== job.contextHash) {
        throw new Error('Planner response context hash does not match.');
    }

    return validateSupportPacket(value.packet, job);
}

export function formatPlannerInstruction(packet, job) {
    const normalized = validateSupportPacket(packet, job);
    const mainPacket = {
        evidence: normalized.evidence,
        constraints: normalized.constraints,
        conflicts: normalized.conflicts,
        uncertainties: normalized.uncertainties,
    };

    return [
        RUNTIME_MESSAGE_MARKER,
        'Private sourced support packet for this response. Do not quote or mention it.',
        'Treat confirmed evidence and hard constraints as binding. Treat inferred evidence and soft constraints cautiously.',
        'You retain control of plot, immediate character reactions, pacing, dialogue, and prose. Do not turn this packet into a visible checklist.',
        JSON.stringify(mainPacket),
    ].join('\n');
}

export function injectPlannerInstruction(messages, packet, job) {
    if (!Array.isArray(messages)) {
        throw new TypeError('Live request messages must be an array.');
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const content = messages[index]?.content;
        if (typeof content === 'string' && content.startsWith('[yezi-reasoning-runtime:')) {
            messages.splice(index, 1);
        }
    }

    const injection = {
        role: 'system',
        content: formatPlannerInstruction(packet, job),
    };
    const lastMessage = messages.at(-1);
    const insertionIndex = lastMessage?.role === 'assistant' ? messages.length - 1 : messages.length;
    messages.splice(insertionIndex, 0, injection);

    return injection;
}

export function injectWriterDirectives(messages, modules) {
    if (!Array.isArray(messages)) {
        throw new TypeError('Live request messages must be an array.');
    }
    const normalizedModules = normalizeCotModules(modules);
    const directives = normalizedModules
        .filter(module => module.route === 'main')
        .map(module => ({
            id: module.id,
            label: module.label,
            category: module.category,
            instruction: module.instruction,
        }));

    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const content = messages[index]?.content;
        if (typeof content === 'string' && content.startsWith(WRITER_DIRECTIVES_MARKER)) {
            messages.splice(index, 1);
        }
    }
    if (!directives.length) return null;

    const injection = {
        role: 'system',
        content: [
            WRITER_DIRECTIVES_MARKER,
            'Direct writer requirements preserved from the externalized ECoT. Apply them while retaining control of plot and prose. Do not quote or mention this block.',
            JSON.stringify(directives),
        ].join('\n'),
    };
    const lastMessage = messages.at(-1);
    const insertionIndex = lastMessage?.role === 'assistant' ? messages.length - 1 : messages.length;
    messages.splice(insertionIndex, 0, injection);
    return injection;
}
