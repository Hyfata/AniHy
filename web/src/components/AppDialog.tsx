import { Modal } from './Modal';
import { useDialogStore } from '../stores/dialog';
import styles from './AppDialog.module.css';

/** 전역 alert/confirm 호스트 — App에 1회 마운트. dialog.alert/confirm 헬퍼로 사용. */
export function AppDialog() {
  const s = useDialogStore();
  return (
    <Modal open={s.open} onClose={() => s.answer(false)} title={s.title} size="sm">
      <p className={styles.message}>{s.message}</p>
      <div className={styles.actions}>
        {s.mode === 'confirm' && (
          <button type="button" className={styles.cancel} onClick={() => s.answer(false)}>
            {s.cancelLabel}
          </button>
        )}
        <button
          type="button"
          className={`${styles.confirm}${s.danger ? ` ${styles.confirmDanger}` : ''}`}
          autoFocus
          onClick={() => s.answer(true)}
        >
          {s.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
