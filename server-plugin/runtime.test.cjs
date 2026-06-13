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
        structuredOutputMode: 'json_object',
        reasoningEffort: '',
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

test('parsePlannerContent extracts a complete JSON object from provider commentary', () => {
    const job = makeJob();
    const packet = makePacket();
    const content = `Compiled result follows.\n${JSON.stringify(packet)}\nEnd of result.`;
    assert.deepEqual(parsePlannerContent(content, job), packet);
});

test('parsePlannerContent rejects plot-control fields', () => {
    const job = makeJob();
    const packet = { ...makePacket(), plannedActions: ['Choose the next plot beat.'] };
    assert.throws(() => parsePlannerContent(JSON.stringify(packet), job), /invalid support packet/);
});

test('parsePlannerContent accepts planner-category constraint kinds', () => {
    const job = makeJob();
    const packet = makePacket({
        constraints: [{
            id: 'constraint-category-1',
            kind: 'cross-module-consistency',
            text: 'Reconcile global constraints without choosing a plot beat.',
            sourceRefs: ['module:continuity-1'],
            strength: 'soft',
        }],
    });
    assert.deepEqual(parsePlannerContent(JSON.stringify(packet), job), packet);
});

test('parsePlannerContent normalizes provider-defined constraint kinds', () => {
    const job = makeJob();
    const packet = makePacket({
        constraints: [{
            id: 'constraint-provider-kind-1',
            kind: 'output-template',
            text: 'Preserve the requested response presentation.',
            sourceRefs: ['module:continuity-1'],
            strength: 'hard',
        }],
    });
    const parsed = parsePlannerContent(JSON.stringify(packet), job);
    assert.equal(parsed.constraints[0].kind, 'other');
});

test('parsePlannerContent reports only short invalid constraint metadata', () => {
    const job = makeJob();
    const packet = makePacket({
        constraints: [{
            id: 'constraint-invalid-1',
            kind: 'physical-rule',
            text: 'Private constraint text must not appear in the diagnostic.',
            sourceRefs: ['module:continuity-1'],
            strength: 'mandatory',
        }],
    });
    assert.throws(
        () => parsePlannerContent(JSON.stringify(packet), job),
        /kind=\\?"physical-rule\\?", strength=\\?"mandatory\\?"/,
    );
    try {
        parsePlannerContent(JSON.stringify(packet), job);
    } catch (error) {
        assert.doesNotMatch(error.message, /Private constraint text/);
    }
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

test('executePlanner forwards an optional provider reasoning effort', async () => {
    let captured;
    await executePlanner({
        job: makeJob(),
        config: makeConfig({ reasoningEffort: 'low' }),
        apiKey: 'test-secret',
        fetchImpl: async (_url, options) => {
            captured = JSON.parse(options.body);
            return providerResponse(makePacket());
        },
    });
    assert.equal(captured.reasoning_effort, 'low');
});

test('executePlanner accepts a required support-packet tool call', async () => {
    const packet = makePacket();
    let captured;
    const result = await executePlanner({
        job: makeJob(),
        config: makeConfig({ structuredOutputMode: 'tool_call' }),
        apiKey: 'test-secret',
        fetchImpl: async (_url, options) => {
            captured = JSON.parse(options.body);
            return new Response(JSON.stringify({
                choices: [{
                    finish_reason: 'tool_calls',
                    message: {
                        content: '',
                        tool_calls: [{
                            type: 'function',
                            function: {
                                name: 'submit_support_packet',
                                arguments: JSON.stringify(packet),
                            },
                        }],
                    },
                }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
    });
    assert.equal(captured.tool_choice.function.name, 'submit_support_packet');
    assert.equal(captured.tools[0].function.parameters.additionalProperties, false);
    assert.deepEqual(result.packet, packet);
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

test('executePlanner reports provider output truncation without exposing content', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
        choices: [{ finish_reason: 'length', message: { content: '{"moduleCoverage":[' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    await assert.rejects(
        executePlanner({
            job: makeJob(),
            config: makeConfig(),
            apiKey: 'test-secret',
            fetchImpl,
        }),
        /output token limit.*Output characters: 19/,
    );
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
