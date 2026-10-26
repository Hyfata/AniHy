import { usePrefsStore } from '../stores/prefs';
import type { Theme } from '../stores/prefs';
import { Modal } from './Modal';
import styles from './SettingsModal.module.css';

const THEMES: [Theme, string][] = [
  ['system', '시스템'],
  ['dark', '다크'],
  ['light', '라이트'],
];

/** Settings modal — theme/playback/notifications. All values are device-local
   (prefs store, persisted to localStorage). */
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const theme = usePrefsStore((s) => s.theme);
  const autoNext = usePrefsStore((s) => s.autoNext);
  const notifyNewEpisodes = usePrefsStore((s) => s.notifyNewEpisodes);
  const setTheme = usePrefsStore((s) => s.setTheme);
  const setAutoNext = usePrefsStore((s) => s.setAutoNext);
  const setNotifyNewEpisodes = usePrefsStore((s) => s.setNotifyNewEpisodes);

  return (
    <Modal open={open} onClose={onClose} title="설정">
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>테마</h3>
        <div className={styles.segmented}>
          {THEMES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`${styles.segmentedBtn}${theme === key ? ` ${styles.segmentedBtnActive}` : ''}`}
              onClick={() => setTheme(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>재생</h3>
        <label className={styles.toggleRow}>
          <span className={styles.toggleLabel}>자동 다음화 재생</span>
          <input
            type="checkbox"
            className={styles.toggleInput}
            checked={autoNext}
            onChange={(e) => setAutoNext(e.target.checked)}
          />
          <span className={styles.toggleTrack}>
            <span className={styles.toggleThumb} />
          </span>
        </label>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>알림</h3>
        <label className={styles.toggleRow}>
          <span className={styles.toggleLabel}>북마크 작품의 새 회차 알림</span>
          <input
            type="checkbox"
            className={styles.toggleInput}
            checked={notifyNewEpisodes}
            onChange={(e) => setNotifyNewEpisodes(e.target.checked)}
          />
          <span className={styles.toggleTrack}>
            <span className={styles.toggleThumb} />
          </span>
        </label>
        <p className={styles.hint}>알림 발송 채널(앱 푸시 등)은 준비 중입니다. 현재는 설정값만 저장됩니다.</p>
      </section>
    </Modal>
  );
}
