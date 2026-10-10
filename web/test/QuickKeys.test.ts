import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import QuickKeys from '../src/components/QuickKeys.vue';

describe('QuickKeys', () => {
  it('puts Enter first and emits the key name for each button', async () => {
    const w = mount(QuickKeys);
    const names = w.findAll('button').map((b) => b.attributes('data-key'));
    expect(names).toEqual(['enter', 'esc', 'tab', 'shift-tab', 'up', 'down', 'left', 'right', 'ctrl-c']);
    await w.find('[data-key="esc"]').trigger('click');
    expect(w.emitted('key')).toEqual([['esc']]);
  });
});
