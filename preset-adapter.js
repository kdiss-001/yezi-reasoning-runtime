import { cloneMessages, normalizeCotModules } from './runtime-core.js';

export const YEZI_PRESET_SOURCE = 'yezi-variable-cot-v1';
export const YEZI_ECOT_START = '<!-- Start the ECoT -->';
export const YEZI_ECOT_END = '<!-- End of The ECoT -->';

const SET_GLOBAL_COT_PREFIX = '{{setglobalvar::cot::';
const GETVAR_PATTERN = /\{\{getvar::([^}]+)\}\}/gi;
const FULL_ECOT_PATTERN = /(?:ECoT需按此模板呈现:\s*)?<!-- Start the ECoT -->\s*<thinking>\s*([\s\S]*?)\s*<\/thinking>\s*<!-- End of The ECoT -->/gi;
const MODULE_ID_PREFIX = 'yezi';
const MAIN_CATEGORIES = new Set(['style', 'format', 'language', 'pov', 'length', 'local-rp', 'output-template']);

const VARIABLE_CATEGORIES = Object.freeze({
    '对话模式': 'format',
    'IF线cot': 'cross-module-consistency',
    '任务确认cot': 'cross-module-consistency',
    '主线剧情cot': 'cross-module-consistency',
    '不抢话cot': 'knowledge-boundary',
    'NPCOT': 'relationship-state',
    'NSFW专注cot': 'continuity',
    '角色卡cot': 'character-state',
    '优先人设': 'character-state',
    '真实RP': 'relationship-state',
    '自然RP': 'relationship-state',
    '关系对齐': 'relationship-state',
    '同人卡cot': 'character-state',
    '反修罗场': 'relationship-state',
    '平等化cot': 'relationship-state',
    '角色迷雾': 'knowledge-boundary',
    '角色活性cot': 'character-state',
    '情绪优化': 'character-state',
    '逻辑思考': 'continuity',
    '多人平衡': 'relationship-state',
    '基调': 'style',
    '善意视角': 'relationship-state',
    '自然塑造cot': 'character-state',
    '防重复cot': 'style',
    '跳过cot': 'cross-module-consistency',
    '座谈会': 'character-state',
    '物理引擎': 'scene-state',
    '特写规划cot': 'style',
    'p_cot': 'cross-module-consistency',
    '变量输出检查cot': 'output-template',
    'meow_FM输出检查cot': 'output-template',
    '小剧场数量cot': 'output-template',
});

const LITERAL_RULES = Object.freeze([
    { pattern: /^\[语言检定\]/, category: 'language' },
    { pattern: /^\[基调锚定\]/, category: 'cross-module-consistency' },
    { pattern: /^\[长线引导\]/, category: 'cross-module-consistency' },
    { pattern: /^\[风格适配\]/, category: 'style' },
    { pattern: /^\[反思\s*&\s*设定校对\]/, category: 'continuity' },
    { pattern: /^\[正文字数检测\]/, category: 'length' },
    { pattern: /^\[输出顺序检查\]/, category: 'output-template' },
    { pattern: /^（果农的誓约/, category: 'cross-module-consistency' },
]);

function canonicalWhitespace(value) {
    return String(value ?? '').replace(/\r\n/g, '\n').trim();
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

function stableModuleId(kind, identity) {
    return `${MODULE_ID_PREFIX}-${kind}-${fnv1a64(identity)}`;
}

function orderedActivePrompts(prompts, promptOrder) {
    if (!Array.isArray(prompts) || !Array.isArray(promptOrder)) {
        throw new TypeError('Preset adapter requires prompt and prompt-order arrays.');
    }
    const byId = new Map(prompts.filter(Boolean).map(prompt => [prompt.identifier, prompt]));
    return promptOrder
        .filter(entry => entry?.enabled === true)
        .map(entry => byId.get(entry.identifier))
        .filter(Boolean);
}

function unwrapCotBuilder(content) {
    const text = String(content ?? '').trim();
    if (!text.toLowerCase().startsWith(SET_GLOBAL_COT_PREFIX)) return null;
    if (!text.endsWith('}}')) {
        throw new Error('Enabled COT builder does not have a closed outer setglobalvar macro.');
    }
    return text.slice(SET_GLOBAL_COT_PREFIX.length, -2);
}

function selectCotBuilder(activePrompts) {
    const builders = activePrompts
        .map((prompt, index) => ({ prompt, index, body: unwrapCotBuilder(prompt.content) }))
        .filter(item => item.body !== null);
    if (!builders.length) return null;
    return builders.at(-1);
}

function findLastSetter(activePrompts, variableName) {
    const needle = `{{setvar::${variableName}::`.toLowerCase();
    for (let index = activePrompts.length - 1; index >= 0; index -= 1) {
        const prompt = activePrompts[index];
        if (String(prompt.content ?? '').toLowerCase().includes(needle)) return prompt;
    }
    return null;
}

function extractVariableNames(builderBody) {
    return [...builderBody.matchAll(GETVAR_PATTERN)].map(match => match[1].trim());
}

function classifyLiteralLine(line) {
    const rule = LITERAL_RULES.find(item => item.pattern.test(line));
    if (!rule) {
        throw new Error(`Unsupported literal COT instruction: ${line.slice(0, 120)}`);
    }
    return rule.category;
}

function buildLiteralModules(builder) {
    const literalText = builder.body.replace(GETVAR_PATTERN, '');
    const lines = literalText
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    return lines.map(line => ({
        id: stableModuleId('literal', `${builder.prompt.identifier}:${line}`),
        label: line.slice(0, 120),
        category: classifyLiteralLine(line),
        instruction: line,
        sourceRef: `prompt:${builder.prompt.identifier}:literal`,
        removable: !MAIN_CATEGORIES.has(classifyLiteralLine(line)),
    }));
}

function buildVariableModules(builder, activePrompts, getLocalVariable, globalCot) {
    const names = extractVariableNames(builder.body);
    const seen = new Set();
    const modules = [];

    for (const variableName of names) {
        if (seen.has(variableName)) continue;
        seen.add(variableName);

        const value = canonicalWhitespace(getLocalVariable(variableName));
        if (!value) continue;
        const category = VARIABLE_CATEGORIES[variableName];
        if (!category) {
            throw new Error(`Unsupported nonempty COT variable '${variableName}'.`);
        }
        if (!canonicalWhitespace(globalCot).includes(value)) {
            throw new Error(`COT variable '${variableName}' is not present in the expanded global COT.`);
        }

        const setter = findLastSetter(activePrompts, variableName);
        if (!setter) {
            throw new Error(`COT variable '${variableName}' has no enabled setter prompt.`);
        }

        modules.push({
            id: stableModuleId('variable', variableName),
            label: `${variableName} / ${setter.name || setter.identifier}`.slice(0, 240),
            category,
            instruction: value,
            sourceRef: `prompt:${setter.identifier}:var:${variableName}`,
            removable: !MAIN_CATEGORIES.has(category),
        });
    }

    return modules;
}

function findEcos(messages) {
    const envelopes = [];
    const assistantPrefills = [];

    messages.forEach((message, messageIndex) => {
        if (typeof message?.content !== 'string') return;
        FULL_ECOT_PATTERN.lastIndex = 0;
        for (const match of message.content.matchAll(FULL_ECOT_PATTERN)) {
            envelopes.push({
                messageIndex,
                start: match.index,
                end: match.index + match[0].length,
                body: canonicalWhitespace(match[1]),
                originalContent: message.content,
            });
        }

        if (message.role === 'assistant' && message.content.trim() === YEZI_ECOT_START) {
            assistantPrefills.push({ messageIndex, originalContent: message.content });
        } else if (message.role === 'assistant' && message.content.includes(YEZI_ECOT_START)) {
            throw new Error('ECoT assistant prefill is mixed with other assistant content.');
        }
    });

    if (envelopes.length !== 1) {
        throw new Error(`Expected exactly one complete ECoT envelope, found ${envelopes.length}.`);
    }
    if (assistantPrefills.length > 1) {
        throw new Error('Expected at most one ECoT assistant prefill.');
    }
    return { envelopes, assistantPrefills };
}

export function removeAdaptedCot(messages, adaptation) {
    const result = cloneMessages(messages);
    const removals = [...adaptation.envelopes, ...adaptation.assistantPrefills]
        .sort((left, right) => right.messageIndex - left.messageIndex);

    for (const removal of removals) {
        const message = result[removal.messageIndex];
        if (!message || message.content !== removal.originalContent) {
            throw new Error('Live request changed after COT adaptation.');
        }

        if (Object.hasOwn(removal, 'start')) {
            const content = `${message.content.slice(0, removal.start)}${message.content.slice(removal.end)}`;
            if (content.trim()) {
                message.content = content.replace(/\n{3,}/g, '\n\n').trim();
            } else {
                result.splice(removal.messageIndex, 1);
            }
        } else {
            result.splice(removal.messageIndex, 1);
        }
    }
    return result;
}

export function adaptYeziPresetRequest({
    messages,
    prompts,
    promptOrder,
    getLocalVariable,
    getGlobalVariable,
}) {
    const activePrompts = orderedActivePrompts(prompts, promptOrder);
    const builder = selectCotBuilder(activePrompts);
    if (!builder) return null;

    if (typeof getLocalVariable !== 'function' || typeof getGlobalVariable !== 'function') {
        throw new TypeError('Preset adapter requires variable getter functions.');
    }

    const globalCot = canonicalWhitespace(getGlobalVariable('cot'));
    if (!globalCot) {
        throw new Error('Enabled COT builder produced an empty global COT value.');
    }

    const locations = findEcos(messages);
    if (locations.envelopes[0].body !== globalCot) {
        throw new Error('Expanded ECoT body does not match the runtime global COT value.');
    }

    const modules = normalizeCotModules([
        ...buildLiteralModules(builder),
        ...buildVariableModules(builder, activePrompts, getLocalVariable, globalCot),
    ]);
    if (!modules.length) {
        throw new Error('Enabled COT builder produced no routable modules.');
    }

    const adaptation = {
        source: YEZI_PRESET_SOURCE,
        builderPromptId: builder.prompt.identifier,
        modules,
        envelopes: locations.envelopes,
        assistantPrefills: locations.assistantPrefills,
    };
    adaptation.plannerMessages = removeAdaptedCot(messages, adaptation);
    return adaptation;
}
