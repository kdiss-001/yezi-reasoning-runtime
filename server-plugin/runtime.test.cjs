'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    PROTOCOL_VERSION,
    computeContextHash,
    executePlanner,
    normalizeProviderEndpoint,
    parsePlannerContent,
    validateJob,
} = require('./runtime.cjs');

function makeJob() {
    const job = {
        protocolVersion: PROTOCOL_VERSION,
        requestId: 'request-1',
        generationType: 'normal',
        context: {
            messages: [{ role: 'user', content: 'Hello' }],
            modelHints: {},
            tokenBudget: 500,
        },
        cot: {
            source: 'test',
            modules: [{
                id: 'continuity-1',
                label: 'Continuity',
                category: 'continuity',
                route: 'planner',
                instruction: 'Compile continuity constraints.',
                sourceRef: 'preset:continuity-1',
                removable: true,
            }],
        },
        state: { providers: {} },
    };
    job.contextHash = computeContextHash(job);
    return job;
}

function makePacket(overrides = {}) {
    return {
        moduleCoverage: [{ moduleId: 'continuity-1', route: 'planner', status: 'compiled' }],
        evidence: [],
        constraints: [],
        conflicts: [],
        uncertainties: [],
        ...overrides,
    };
}

function makeConfig(overrides = {}) {
    return {
        baseUrl: 'https://planner.example/v1',
        model: 'planner-model',
        maxTokens: 800,
        temperature: 0.2,
        timeoutMs: 5000,
        retryCount: 0,
        structuredOutput: true,
        ...overrides,
    };
}

function providerResponse(packet) {
    return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(packet) } }],
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

test('normalizeProviderEndpoint accepts a base URL or full endpoint', () => {
    assert.equal(
        normalizeProviderEndpoint('https://planner.example/v1/'),
        'https://planner.example/v1/chat/completions',
    );
    assert.equal(
        normalizeProviderEndpoint('https://planner.example/v1/chat/completions'),
        'https://planner.example/v1/chat/completions',
    );
});

test('validateJob rejects client-forged routing and stale hashes', () => {
    const forgedRoute = makeJob();
    forgedRoute.cot.modules[0].route = 'main';
    forgedRoute.contextHash = computeContextHash(forgedRoute);
    assert.throws(() => validateJob(forgedRoute), /invalid category route/);

    const staleHash = makeJob();
    staleHash.context.messages[0].content = 'Changed';
    assert.throws(() => validateJob(staleHash), /context hash is invalid/);
});

test('parsePlannerContent accepts a fenced sourced support packet', () => {
    const job = makeJob();
    const packet = makePacket({
        constraints: [{
            id: 'constraint-1',
            kind: 'continuity',
            text: 'Keep the greeting as established context.',
            sourceRefs: ['message:0', 'module:continuity-1'],
            strength: 'hard',
        }],
    });
    assert.deepEqual(parsePlannerContent(`\`\`\`json\n${JSON.stringify(packet)}\n\`\`\``, job), packet);
});

test('parsePlannerContent rejects plot-control fields', () => {
    const job = makeJob();
    const packet = { ...makePacket(), plannedActions: ['Choose the next plot beat.'] };
    assert.throws(() => parsePlannerContent(JSON.stringify(packet), job), /invalid support packet/);
});

test('executePlanner sends routed modules and returns a bound envelope', async () => {
    const job = makeJob();
    const packet = makePacket({
        evidence: [{
            id: 'fact-1',
            kind: 'fact',
            text: 'The user said hello.',
            sourceRefs: ['message:0'],
            certainty: 'confirmed',
        }],
    });
    let captured;
    const fetchImpl = async (url, options) => {
        captured = { url, options };
        return providerResponse(packet);
    };

    const result = await executePlanner({
        job,
        config: makeConfig(),
        apiKey: 'test-secret',
        fetchImpl,
    });

    const sent = JSON.parse(captured.options.body);
    const plannerInput = JSON.parse(sent.messages[1].content);
    assert.equal(captured.url, 'https://planner.example/v1/chat/completions');
    assert.equal(captured.options.headers.Authorization, 'Bearer test-secret');
    assert.equal(plannerInput.context.messages[0].sourceRef, 'message:0');
    assert.equal(plannerInput.cot.modules[0].route, 'planner');
    assert.deepEqual(result.packet, packet);
    assert.equal(result.protocolVersion, PROTOCOL_VERSION);
    assert.equal(result.contextHash, job.contextHash);
    assert.equal(result.meta.attempts, 1);
});

test('executePlanner retries retryable provider failures', async () => {
    const job = makeJob();
    let attempts = 0;
    const fetchImpl = async () => {
        attempts += 1;
        if (attempts === 1) {
            return new Response(JSON.stringify({ error: { message: 'temporary' } }), { status: 500 });
        }
        return providerResponse(makePacket());
    };

    const result = await executePlanner({
        job,
        config: makeConfig({ retryCount: 1 }),
        apiKey: 'test-secret',
        fetchImpl,
    });

    assert.equal(attempts, 2);
    assert.equal(result.meta.attempts, 2);
});

test('executePlanner honors an already cancelled generation', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;

    await assert.rejects(
        executePlanner({
            job: makeJob(),
            config: makeConfig(),
            apiKey: 'test-secret',
            signal: controller.signal,
            fetchImpl: async () => {
                called = true;
                return providerResponse(makePacket());
            },
        }),
        { name: 'PlannerCancelledError' },
    );
    assert.equal(called, false);
});
