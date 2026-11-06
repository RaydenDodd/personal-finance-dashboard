import * as sync from '@/api/sheets-sync';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SheetsSyncPanel from './sheets-sync-panel.vue';

vi.mock('@/api/sheets-sync', () => ({
  getSheetsSyncStatus: vi.fn(),
  resolveSheetsSyncConflict: vi.fn(),
  runSheetsSync: vi.fn(),
  saveSheetsServiceAccount: vi.fn(),
  saveSheetsSyncConfig: vi.fn(),
  startSheetsOAuth: vi.fn(),
}));
const status: sync.SheetsSyncStatus = {
  config: {
    enabled: true,
    spreadsheetId: 'synthetic-sheet',
    sheetName: 'Synthetic history',
    sheetId: 0,
    mirrorSimplefin: false,
    mappings: [{ accountId: 'saving', balanceRow: 4 }],
  },
  credentialsConfigured: false,
  oauthConfigured: false,
  authKind: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastErrorCode: 'credentials_missing',
  pendingWrites: 1,
  conflicts: [],
};
const render = () =>
  mount(SheetsSyncPanel, {
    global: {
      stubs: {
        Card: { template: '<section><slot /></section>' },
        Button: { template: '<button><slot /></button>' },
        Callout: { props: ['title'], template: '<aside><strong>{{ title }}</strong><slot /></aside>' },
      },
    },
  });
const button = (wrapper: ReturnType<typeof render>, text: string) =>
  wrapper.findAll('button').find((node) => node.text() === text)!;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sync.getSheetsSyncStatus).mockResolvedValue(structuredClone(status));
});

describe('Google Sheets synchronization controls', () => {
  it('keeps manual balances available and does not claim live sync before Google access is configured', async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain('Connection required');
    expect(wrapper.text()).toContain('manual updates remain available');
    expect(button(wrapper, 'Sync now').attributes('disabled')).toBeDefined();
    expect(sync.runSheetsSync).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('retains the existing account mapping when saving the provider mirror preference', async () => {
    const wrapper = render();
    await flushPromises();
    await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(true);
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(sync.saveSheetsSyncConfig).toHaveBeenCalledWith({ ...status.config, mirrorSimplefin: true });
    wrapper.unmount();
  });
  it('resolves an explicit conflict and refreshes related balances after the owner chooses a value', async () => {
    vi.mocked(sync.getSheetsSyncStatus).mockResolvedValue({
      ...structuredClone(status),
      credentialsConfigured: true,
      conflicts: [
        {
          id: 'conflict',
          accountId: 'saving',
          date: '2026-11-05',
          kind: 'balance',
          sheetValue: 125.25,
          dashboardValue: 130.25,
          reason: 'both_changed',
          status: 'open',
        },
      ],
    });
    const wrapper = render();
    await flushPromises();
    await button(wrapper, 'Use Sheet value').trigger('click');
    await flushPromises();
    expect(sync.resolveSheetsSyncConflict).toHaveBeenCalledWith('conflict', 'sheet');
    expect(wrapper.emitted('updated')).toHaveLength(1);
    wrapper.unmount();
  });
  it('uploads a service-account key without putting its secret into rendered text', async () => {
    const wrapper = render();
    await flushPromises();
    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      value: [
        {
          size: 150,
          text: async () =>
            JSON.stringify({
              type: 'service_account',
              client_email: 'synthetic@example.invalid',
              private_key: 'synthetic-private-key-never-render',
            }),
        },
      ],
    });
    await input.trigger('change');
    await flushPromises();
    expect(sync.saveSheetsServiceAccount).toHaveBeenCalledWith({
      clientEmail: 'synthetic@example.invalid',
      privateKey: 'synthetic-private-key-never-render',
    });
    expect(wrapper.html()).not.toContain('synthetic-private-key-never-render');
    expect((input.element as HTMLInputElement).value).toBe('');
    wrapper.unmount();
  });
  it('does not upload unrelated JSON credential files', async () => {
    const wrapper = render();
    await flushPromises();
    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      value: [{ size: 50, text: async () => '{"access_token":"do-not-upload"}' }],
    });
    await input.trigger('change');
    await flushPromises();
    expect(sync.saveSheetsServiceAccount).not.toHaveBeenCalled();
    expect(wrapper.html()).not.toContain('do-not-upload');
    expect(wrapper.text()).toContain('Existing records have been preserved');
    wrapper.unmount();
  });
});
