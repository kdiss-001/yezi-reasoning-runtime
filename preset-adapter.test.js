import test from 'node:test';
import assert from 'node:assert/strict';

import {
    YEZI_ECOT_END,
    YEZI_ECOT_START,
    YEZI_PRESET_SOURCE,
    adaptYeziPresetRequest,
    removeAdaptedCot,
} from './preset-adapter.js';

const BUILDER_ID = 'builder-1';
const RECEIVER_ID = 'receiver-1';

function makeFixture(overrides = {}) {
    const builderContent = `{{setglobalvar::cot::
[语言检定]{{getvar::对话模式}}
{{getvar::任务确认cot}}
[基调锚定](确认规则)
[风格适配](遵循写作指导){{getvar::基调}}
{{getvar::防重复cot}}
[反思 & 设定校对](保持一致)
{{getvar::物理引擎}}
[正文字数检测]
[输出顺序检查]
（果农的誓约、自我陈词和反思）
}}`;
    const values = {
        对话模式: '[对话模式] 保持自然对白。',
        任务确认cot: '[任务确认] 理解用户输入。',
        基调: '保持克制温暖的基调。',
        防重复cot: '<防重复> 避免复述上文。',
        物理引擎: '[物理规则] 保持肢体和空间连续。',
        ...(overrides.values ?? {}),
    };
    const globalCot = [
        `[语言检定]${values.对话模式}`,
        values.任务确认cot,
        '[基调锚定](确认规则)',
        `[风格适配](遵循写作指导)${values.基调}`,
        values.防重复cot,
        '[反思 & 设定校对](保持一致)',
        values.物理引擎,
        '[正文字数检测]',
        '[输出顺序检查]',
        '（果农的誓约、自我陈词和反思）',
    ].join('\n');
    const prompts = [
        {
            identifier: 'defaults',
            name: 'Defaults',
            content: '{{setvar::对话模式:: }}{{setvar::任务确认cot:: }}{{setvar::基调:: }}{{setvar::防重复cot:: }}{{setvar::物理引擎:: }}',
        },
        { identifier: 'dialogue', name: 'Dialogue', content: '{{setvar::对话模式::value}}' },
        { identifier: 'task-old', name: 'Old task', content: '{{setvar::任务确认cot::old}}' },
        { identifier: 'task-new', name: 'New task', content: '{{setvar::任务确认cot::new}}' },
        { identifier: 'tone', name: 'Tone', content: '{{setvar::基调::value}}' },
        { identifier: 'repeat', name: 'No repeat', content: '{{setvar::防重复cot::value}}' },
        { identifier: 'physics', name: 'Physics', content: '{{setvar::物理引擎::value}}' },
        { identifier: BUILDER_ID, name: 'COT builder', content: builderContent },
        {
            identifier: RECEIVER_ID,
            name: 'COT receiver',
            content: `ECoT需按此模板呈现:\n${YEZI_ECOT_START}\n<thinking>{{getglobalvar::cot}}</thinking>\n${YEZI_ECOT_END}`,
        },
    ];
    const promptOrder = prompts.map(prompt => ({ identifier: prompt.identifier, enabled: true }));
    const messages = [
        {
            role: 'system',
            content: `Before\n\nECoT需按此模板呈现:\n${YEZI_ECOT_START}\n<thinking>\n${globalCot}\n</thinking>\n${YEZI_ECOT_END}\n\nAfter`,
        },
        { role: 'assistant', content: YEZI_ECOT_START },
    ];

    return {
        prompts,
        promptOrder,
        messages,
        values,
        globalCot: overrides.globalCot ?? globalCot,
    };
}

function adapt(fixture) {
    return adaptYeziPresetRequest({
        messages: fixture.messages,
        prompts: fixture.prompts,
        promptOrder: fixture.promptOrder,
        getLocalVariable: name => fixture.values[name] ?? '',
        getGlobalVariable: name => name === 'cot' ? fixture.globalCot : '',
    });
}

test('adapter builds routed modules and traces the last enabled setter', () => {
    const fixture = makeFixture();
    const result = adapt(fixture);

    assert.equal(result.source, YEZI_PRESET_SOURCE);
    assert.equal(result.builderPromptId, BUILDER_ID);
    const task = result.modules.find(module => module.label.startsWith('任务确认cot'));
    assert.equal(task.route, 'planner');
    assert.match(task.sourceRef, /task-new/);

    const noRepeat = result.modules.find(module => module.label.startsWith('防重复cot'));
    assert.equal(noRepeat.route, 'main');
    assert.equal(noRepeat.removable, false);
    assert.ok(result.modules.some(module => module.category === 'output-template' && module.route === 'main'));
});

test('adapter removes the complete ECoT and dedicated assistant prefill from planner context', () => {
    const fixture = makeFixture();
    const result = adapt(fixture);

    assert.equal(result.plannerMessages.length, 1);
    assert.equal(result.plannerMessages[0].content, 'Before\n\nAfter');
    assert.doesNotMatch(result.plannerMessages[0].content, /thinking|Start the ECoT/);
    assert.deepEqual(fixture.messages[1], { role: 'assistant', content: YEZI_ECOT_START });
});

test('removeAdaptedCot fails when the live message changed after adaptation', () => {
    const fixture = makeFixture();
    const result = adapt(fixture);
    const changed = structuredClone(fixture.messages);
    changed[0].content += '\nLate mutation';

    assert.throws(() => removeAdaptedCot(changed, result), /changed after COT adaptation/);
});

test('adapter rejects an ECoT body that differs from the runtime global COT', () => {
    const fixture = makeFixture({ globalCot: 'different' });
    assert.throws(() => adapt(fixture), /does not match/);
});

test('adapter rejects an ECoT prefill mixed with other assistant content', () => {
    const fixture = makeFixture();
    fixture.messages[1].content = `${YEZI_ECOT_START}\nDo something else`;
    assert.throws(() => adapt(fixture), /mixed with other assistant content/);
});

test('adapter rejects a nonempty variable without a routing rule', () => {
    const fixture = makeFixture();
    const builder = fixture.prompts.find(prompt => prompt.identifier === BUILDER_ID);
    builder.content = builder.content.replace('[输出顺序检查]', '{{getvar::未知模块}}\n[输出顺序检查]');
    fixture.values.未知模块 = '[未知模块] should fail closed';
    fixture.globalCot = fixture.globalCot.replace('[输出顺序检查]', `${fixture.values.未知模块}\n[输出顺序检查]`);
    fixture.messages[0].content = fixture.messages[0].content.replace(
        '[输出顺序检查]',
        `${fixture.values.未知模块}\n[输出顺序检查]`,
    );

    assert.throws(() => adapt(fixture), /Unsupported nonempty COT variable/);
});
