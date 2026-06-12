'use strict';

const {
    PlannerCancelledError,
    PlannerTimeoutError,
    ProviderError,
    ValidationError,
    executePlanner,
} = require('./runtime.cjs');

const API_KEY_ENV = 'SILLYTAVERN_REASONING_RUNTIME_API_KEY';

const info = {
    id: 'yezi-reasoning-runtime',
    name: 'Yezi Reasoning Runtime',
    description: 'Proxies one independently configured structured planner call before main generation.',
};

function errorStatus(error) {
    if (error instanceof ValidationError) {
        return error.message.includes('not configured') ? 503 : 400;
    }
    if (error instanceof PlannerTimeoutError) return 504;
    if (error instanceof PlannerCancelledError) return 499;
    if (error instanceof ProviderError) return 502;
    return 500;
}

function publicErrorMessage(error) {
    if (
        error instanceof ValidationError
        || error instanceof PlannerTimeoutError
        || error instanceof PlannerCancelledError
        || error instanceof ProviderError
    ) {
        return error.message;
    }
    return 'Unexpected planner plugin error.';
}

async function init(router) {
    router.get('/status', (_request, response) => {
        response.json({
            version: '0.2.0',
            configured: Boolean(process.env[API_KEY_ENV]?.trim()),
            secretSource: API_KEY_ENV,
        });
    });

    router.post('/plan', async (request, response) => {
        const controller = new AbortController();
        const cancelOnDisconnect = () => {
            if (!response.writableEnded) controller.abort();
        };
        response.on('close', cancelOnDisconnect);

        try {
            const result = await executePlanner({
                job: request.body?.job,
                config: request.body?.config,
                apiKey: process.env[API_KEY_ENV],
                signal: controller.signal,
            });
            if (!response.writableEnded) {
                response.json(result);
            }
        } catch (error) {
            console.warn(`[Yezi Reasoning Runtime] Planner request failed (${error.name}).`);
            if (!response.writableEnded) {
                response.status(errorStatus(error)).json({ error: publicErrorMessage(error) });
            }
        } finally {
            response.off('close', cancelOnDisconnect);
        }
    });
}

module.exports = { info, init };
