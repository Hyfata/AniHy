import { useState } from 'react';
import { useAuthStore } from '../../stores/auth';
import { QueueModal } from './QueueModal';
import styles from './QueueModal.module.css';

/** 대기열 모달을 여는 고정 액션 버튼 (관리자 전용).
   사용법: 관리자 기능이 필요한 페이지에서 `<QueueLauncher />`를 마운트하면 된다.
   identity.is_admin이 아니면 아무것도 렌더하지 않는다. */
export function QueueLauncher() {
  const isAdmin = useAuthStore((s) => s.identity?.is_admin ?? false);
  const [open, setOpen] = useState(false);

  if (!isAdmin) return null;

  return (
    <>
      <button type="button" className={styles.launcher} onClick={() => setOpen(true)}>
        <span className={styles.launcherDot} aria-hidden="true" />
        대기열
      </button>
      <QueueModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
