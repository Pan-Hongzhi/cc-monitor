import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Composer from '../src/components/Composer.vue';

describe('Composer', () => {
  it('emits send with the text and clears the box', async () => {
    const w = mount(Composer);
    await w.find('textarea').setValue('帮我看看\n第二行');
    await w.find('[data-test="send"]').trigger('click');
    expect(w.emitted('send')).toEqual([['帮我看看\n第二行']]);
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('');
  });
  it('ignores blank text', async () => {
    const w = mount(Composer);
    await w.find('textarea').setValue('   \n');
    await w.find('[data-test="send"]').trigger('click');
    expect(w.emitted('send')).toBeUndefined();
  });
  it('sends on ctrl+enter', async () => {
    const w = mount(Composer);
    await w.find('textarea').setValue('go');
    await w.find('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true });
    expect(w.emitted('send')).toEqual([['go']]);
  });
  it('disables controls when asked', () => {
    const w = mount(Composer, { props: { disabled: true } });
    expect(w.find('textarea').attributes('disabled')).toBeDefined();
    expect(w.find('[data-test="send"]').attributes('disabled')).toBeDefined();
  });
});
