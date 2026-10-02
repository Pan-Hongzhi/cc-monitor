import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import QuickKeys from '../src/components/QuickKeys.vue';

describe('QuickKeys', () => {
  it('emits the key name for each button', async () => {
    const w = mount(QuickKeys);
    const names = w.findAll('button').map((b) => b.attributes('data-key'));
    expect(names).toEqual(['esc', 'ctrl-c', 'tab', 'shift-tab', 'up', 'down', 'left', 'right', 'enter']);
    await w.find('[data-key="esc"]').trigger('click');
    expect(w.emitted('key')).toEqual([['esc']]);
  });
});
