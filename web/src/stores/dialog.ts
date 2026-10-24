import { create } from 'zustand';

/** 네이티브 window.alert/confirm 대체 — 앱 내 모달 다이얼로그 (구 inc/alert_modal.php 계승) */

interface DialogOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 확인 버튼을 위험(빨강) 스타일로 */
  danger?: boolean;
}

interface DialogState {
  open: boolean;
  mode: 'alert' | 'confirm';
  message: string;
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: ((ok: boolean) => void) | null;
  ask: (mode: 'alert' | 'confirm', message: string, opts: DialogOptions | undefined, resolve: (ok: boolean) => void) => void;
  answer: (ok: boolean) => void;
}

export const useDialogStore = create<DialogState>((set, get) => ({
  open: false,
  mode: 'alert',
  message: '',
  title: '알림',
  confirmLabel: '확인',
  cancelLabel: '취소',
  danger: false,
  resolve: null,

  ask: (mode, message, opts, resolve) =>
    set({
      open: true,
      mode,
      message,
      title: opts?.title ?? '알림',
      confirmLabel: opts?.confirmLabel ?? '확인',
      cancelLabel: opts?.cancelLabel ?? '취소',
      danger: opts?.danger ?? false,
      resolve,
    }),

  answer: (ok) => {
    get().resolve?.(ok);
    set({ open: false, resolve: null });
  },
}));

export const dialog = {
  alert: (message: string, opts?: DialogOptions): Promise<void> =>
    new Promise((resolve) =>
      useDialogStore.getState().ask('alert', message, opts, () => resolve()),
    ),
  confirm: (message: string, opts?: DialogOptions): Promise<boolean> =>
    new Promise((resolve) => useDialogStore.getState().ask('confirm', message, opts, resolve)),
};
