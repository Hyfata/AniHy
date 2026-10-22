import { useAuthStore } from '../../stores/auth';
import styles from './library.module.css';

/** 북마크/시청기록 공통 — 비로그인(401) 상태 로그인 유도 카드 */
export function LoginPrompt({ feature }: { feature: string }) {
  const login = useAuthStore((s) => s.login);
  return (
    <div className={styles.loginPrompt}>
      <p className={styles.loginPromptTitle}>로그인이 필요합니다</p>
      <p className={styles.loginPromptDesc}>{feature}은(는) 로그인 후 이용할 수 있습니다.</p>
      <button type="button" className={styles.loginPromptBtn} onClick={login}>
        로그인
      </button>
    </div>
  );
}
