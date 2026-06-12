import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PROTOCOL_VERSION,
    RUNTIME_MESSAGE_MARKER,
    WRITER_DIRECTIVES_MARKER,
    buildPlannerJob,
    injectPlannerInstruction,
    injectWriterDirectives,
    normalizeCotModules,
    validatePlannerEnvelope,
    validateSupportPacket,
} from './runtime-core.js';

function makeGenerateData() {
    return {
        type: 'normal',
        model: 'main-model',
        chat_completion_source: 'openai',
        max_tokens: 500,
        messages: [{ role: 'user', content: 'Original' }],
    };
}

function makeModules() {
    return [
        {
            id: 'continuity-1',
            label: 'Continuity check',
            category: 'continuity',
            instruction: 'Compile established continuity constraints.',
            sourceRef: 'preset:continuity-1',
            removable: true,
        },
        {
            id: 'style-1',
            label: 'Style direction',
            category: 'style',
            instruction: 'Use concise sensory prose.',
            sourceRef: 'preset:style-1',
            removable: false,
        },
    ];
}

function makeJob() {
    return buildPlannerJob(makeGenerateData(), {
        cotSource: 'test-adapter',
        modules: makeModules(),
        stateProviders: { mvu: { phase: 'day' } },
    });
}

function makePacket(job, overrides = {}) {
    return {
        moduleCoverage: job.cot.modules.map(module => ({
            moduleId: module.id,
            route: module.route,
            status: module.route === 'planner' ? 'compiled' : 'preserved',
        })),
        evidence: [],
        constraints: [],
        conflicts: [],
        uncertainties: [],
        ...overrides,
    };
}

test('normalizeCotModules routes categories deterministically', () => {
    const modules = normalizeCotModules(makeModules());
    assert.equal(modules[0].route, 'planner');
    assert.equal(modules[1].route, 'main');
});

test('normalizeCotModules rejects removing a main-routed instruction', () => {
    const modules = makeModules();
    modules[1].removable = true;
    assert.throws(() => normalizeCotModules(modules), /Only planner-routed/);
});

test('buildPlannerJob clones context and fingerprints routed input', () => {
    const generateData = makeGenerateData();
    generateData.messages[0].transient = undefined;
    const job = buildPlannerJob(generateData, { modules: makeModules() });
    job.context.messages[0].content = 'Changed';

    assert.equal(generateData.messages[0].content, 'Original');
    assert.equal(job.protocolVersion, PROTOCOL_VERSION);
    assert.match(job.contextHash, /^fnv1a64:[0-9a-f]{16}$/);
    assert.equal(job.cot.modules[0].route, 'planner');
    assert.equal(job.cot.modules[1].route, 'main');
    assert.equal(
        job.contextHash,
        buildPlannerJob({ ...generateData, messages: JSON.parse(JSON.stringify(generateData.messages)) }, {
            modules: makeModules(),
        }).contextHash,
    );
});

test('validateSupportPacket accepts sourced evidence and constraints', () => {
    const job = makeJob();
    const packet = makePacket(job, {
        evidence: [{
            id: 'fact-1',
            kind: 'fact',
            text: 'The user entered the room.',
            sourceRefs: ['message:0'],
            certainty: 'confirmed',
        }],
        constraints: [{
            id: 'constraint-1',
            kind: 'continuity',
            text: 'Do not place the user outside the room without a transition.',
            sourceRefs: ['message:0', 'module:continuity-1'],
            strength: 'hard',
        }],
    });

    assert.deepEqual(validateSupportPacket(packet, job), packet);
});

test('validateSupportPacket rejects incomplete module coverage', () => {
    const job = makeJob();
    const packet = makePacket(job);
    packet.moduleCoverage.pop();
    assert.throws(() => validateSupportPacket(packet, job), /coverage is incomplete/);
});

test('validateSupportPacket rejects invented source references', () => {
    const job = makeJob();
    const packet = makePacket(job, {
        evidence: [{
            id: 'fact-1',
            kind: 'fact',
            text: 'Unsupported claim.',
            sourceRefs: ['message:99'],
            certainty: 'confirmed',
        }],
    });
    assert.throws(() => validateSupportPacket(packet, job), /unknown source/);
});

test('validateSupportPacket rejects legacy plot-control fields', () => {
    const job = makeJob();
    const packet = { ...makePacket(job), plannedActions: ['Force a kiss.'] };
    assert.throws(() => validateSupportPacket(packet, job), /unexpected or missing fields/);
});

test('validatePlannerEnvelope enforces request identity and context hash', () => {
    const job = makeJob();
    const packet = makePacket(job);
    assert.throws(
        () => validatePlannerEnvelope({
            protocolVersion: PROTOCOL_VERSION,
            requestId: job.requestId,
            contextHash: 'fnv1a64:0000000000000000',
            packet,
        }, job),
        /context hash does not match/,
    );
});

test('injectPlannerInstruction inserts sourced packet before assistant prefill', () => {
    const job = makeJob();
    const packet = makePacket(job, {
        uncertainties: [{
            id: 'uncertain-1',
            text: 'The door state is not established.',
            sourceRefs: ['message:0'],
        }],
    });
    const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'system', content: '[yezi-reasoning-runtime:v1]\nold' },
        { role: 'assistant', content: 'Prefill' },
    ];

    injectPlannerInstruction(messages, packet, job);

    assert.equal(messages.length, 3);
    assert.equal(messages[1].role, 'system');
    assert.match(messages[1].content, new RegExp(RUNTIME_MESSAGE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(messages[1].content, /door state is not established/);
    assert.doesNotMatch(messages[1].content, /moduleCoverage/);
    assert.equal(messages[2].content, 'Prefill');
});

test('injectWriterDirectives preserves only main-routed modules', () => {
    const messages = [{ role: 'user', content: 'Continue' }];
    injectWriterDirectives(messages, makeModules());

    assert.equal(messages.length, 2);
    assert.match(messages[1].content, new RegExp(WRITER_DIRECTIVES_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(messages[1].content, /Use concise sensory prose/);
    assert.doesNotMatch(messages[1].content, /Compile established continuity constraints/);
});
