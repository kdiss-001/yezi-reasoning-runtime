import {
    eventSource,
    event_types,
    getRequestHeaders,
    saveSettingsDebounced,
} from '../../../../script.js';
import {
    extension_settings,
    renderExtensionTemplateAsync,
} from '../../../extensions.js';
import { promptManager } from '../../../openai.js';
import { getGlobalVariable, getLocalVariable } from '../../../variables.js';
import {
    buildPlannerJob,
    injectPlannerInstruction,
    injectWriterDirectives,
    validatePlannerEnvelope,
} from './runtime-core.js';
import { adaptYeziPresetRequest, removeAdaptedCot } from './preset-adapter.js';

const MODULE_NAME = 'yezi_reasoning_runtime';
const EXTENSION_PATH = 'third-party/yezi-reasoning-runtime';
const PLUGIN_BASE_PATH = '/api/plugins/yezi-reasoning-runtime';
const REQUEST_MARKER = Symbol.for('yezi.reasoning-runtime.intercepted');

const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    maxTokens: 1200,
    temperature: 0.2,
    timeoutMs: 45000,
    retryCount: 1,
    structuredOutputMode: 'json_object',
    reasoningEffort: '',
});

let activeController = null;
let intercepting = false;

function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }

    const settings = extension_settings[MODULE_NAME];
    if (!Object.hasOwn(settings, 'structuredOutputMode')) {
        settings.structuredOutputMode = settings.structuredOutput === false ? 'none' : 'json_object';
    }
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = value;
        }
    }

    return settings;
}

function setStatus(message, kind = 'neutral') {
    const element = document.querySelector('#yrr_status');
    if (!element) return;

    element.textContent = message;
    element.dataset.kind = kind;
}

function updateSettingsFromUi() {
    const settings = getSettings();
    settings.enabled = document.querySelector('#yrr_enabled')?.checked ?? false;
    settings.baseUrl = document.querySelector('#yrr_base_url')?.value.trim() ?? '';
    settings.model = document.querySelector('#yrr_model')?.value.trim() ?? '';
    settings.maxTokens = Number(document.querySelector('#yrr_max_tokens')?.value) || DEFAULT_SETTINGS.maxTokens;
    settings.temperature = Number(document.querySelector('#yrr_temperature')?.value) || 0;
    settings.timeoutMs = Number(document.querySelector('#yrr_timeout_ms')?.value) || DEFAULT_SETTINGS.timeoutMs;
    settings.retryCount = Number(document.querySelector('#yrr_retry_count')?.value) || 0;
    settings.structuredOutputMode = document.querySelector('#yrr_structured_output_mode')?.value ?? 'none';
    settings.reasoningEffort = document.querySelector('#yrr_reasoning_effort')?.value ?? '';
    saveSettingsDebounced();
}

function loadSettingsIntoUi() {
    const settings = getSettings();
    const values = {
        '#yrr_enabled': settings.enabled,
        '#yrr_base_url': settings.baseUrl,
        '#yrr_model': settings.model,
        '#yrr_max_tokens': settings.maxTokens,
        '#yrr_temperature': settings.temperature,
        '#yrr_timeout_ms': settings.timeoutMs,
        '#yrr_retry_count': settings.retryCount,
        '#yrr_structured_output_mode': settings.structuredOutputMode,
        '#yrr_reasoning_effort': settings.reasoningEffort,
    };

    for (const [selector, value] of Object.entries(values)) {
        const element = document.querySelector(selector);
        if (!element) continue;
        if (element instanceof HTMLInputElement && element.type === 'checkbox') {
            element.checked = Boolean(value);
        } else {
            element.value = String(value);
        }
    }
}

async function refreshPluginStatus() {
    setStatus('Checking server plugin...');

    try {
        const response = await fetch(`${PLUGIN_BASE_PATH}/status`, {
            headers: getRequestHeaders(),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const status = await response.json();
        setStatus(
            status.configured
                ? `Server plugin ready; secret source: ${status.secretSource}`
                : `Server plugin loaded; set ${status.secretSource}`,
            status.configured ? 'ok' : 'warning',
        );
    } catch (error) {
        setStatus(`Server plugin unavailable: ${error.message}`, 'error');
    }
}

async function requestPlan(job, settings, signal) {
    const response = await fetch(`${PLUGIN_BASE_PATH}/plan`, {
        method: 'POST',
        headers: getRequestHeaders(),
        signal,
        body: JSON.stringify({
            job,
            config: {
                baseUrl: settings.baseUrl,
                model: settings.model,
                maxTokens: settings.maxTokens,
                temperature: settings.temperature,
                timeoutMs: settings.timeoutMs,
                retryCount: settings.retryCount,
                structuredOutputMode: settings.structuredOutputMode,
                reasoningEffort: settings.reasoningEffort,
            },
        }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `Planner endpoint returned HTTP ${response.status}.`);
    }

    return validatePlannerEnvelope(payload, job);
}

async function interceptChatCompletion(generateData) {
    const settings = getSettings();
    if (!settings.enabled || !Array.isArray(generateData?.messages)) return;
    if (intercepting || generateData[REQUEST_MARKER]) return;

    Object.defineProperty(generateData, REQUEST_MARKER, {
        value: true,
        configurable: false,
        enumerable: false,
    });

    intercepting = true;
    activeController = new AbortController();

    try {
        const promptOrder = promptManager?.getPromptOrderForCharacter?.(promptManager.activeCharacter) ?? [];
        const prompts = promptManager?.serviceSettings?.prompts ?? [];
        const adaptation = adaptYeziPresetRequest({
            messages: generateData.messages,
            prompts,
            promptOrder: promptOrder.filter(entry => {
                const prompt = promptManager?.getPromptById?.(entry.identifier);
                return entry.enabled === true && promptManager?.shouldTrigger?.(prompt, generateData.type ?? 'normal') !== false;
            }),
            getLocalVariable,
            getGlobalVariable,
        });
        if (!adaptation) {
            setStatus('No supported variable-COT preset detected; original request preserved.', 'warning');
            return;
        }

        const job = buildPlannerJob(generateData, {
            cotSource: adaptation.source,
            modules: adaptation.modules,
            contextMessages: adaptation.plannerMessages,
        });
        setStatus(`Planning ${job.requestId.slice(0, 8)}...`);
        const plan = await requestPlan(job, settings, activeController.signal);

        // Build the entire success transformation on a clone, then commit it atomically.
        const transformedMessages = removeAdaptedCot(generateData.messages, adaptation);
        injectWriterDirectives(transformedMessages, adaptation.modules);
        injectPlannerInstruction(transformedMessages, plan, job);
        generateData.messages.splice(0, generateData.messages.length, ...transformedMessages);
        setStatus(`Planner completed for ${job.requestId.slice(0, 8)}.`, 'ok');
    } catch (error) {
        if (error.name === 'AbortError') {
            setStatus('Planner cancelled; original request left unchanged.', 'warning');
        } else {
            console.warn('[Yezi Reasoning Runtime] Planner failed; using the original request.', error);
            setStatus(`Planner failed; original request preserved: ${error.message}`, 'error');
        }
    } finally {
        activeController = null;
        intercepting = false;
    }
}

async function initialize() {
    const settingsHtml = await renderExtensionTemplateAsync(EXTENSION_PATH, 'settings');
    document.querySelector('#extensions_settings2')?.insertAdjacentHTML('beforeend', settingsHtml);
    loadSettingsIntoUi();

    document.querySelector('#yrr_settings')?.addEventListener('input', updateSettingsFromUi);
    document.querySelector('#yrr_settings')?.addEventListener('change', updateSettingsFromUi);
    document.querySelector('#yrr_check_plugin')?.addEventListener('click', refreshPluginStatus);
    await refreshPluginStatus();
}

eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, interceptChatCompletion);
eventSource.on(event_types.GENERATION_STOPPED, () => activeController?.abort());

jQuery(() => initialize().catch((error) => {
    console.error('[Yezi Reasoning Runtime] Extension initialization failed.', error);
}));
