import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, post } from '../api/client';
import { DEFAULT_NEW_BADGE_DAYS, useSiteConfig } from '../lib/recency';
import { useAuthStore } from '../stores/auth';
import { dialog } from '../stores/dialog';
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
   (prefs store, persisted to localStorage). Admins additionally get server-wide
   settings (access code, New badge window). */
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const theme = usePrefsStore((s) => s.theme);
  const autoNext = usePrefsStore((s) => s.autoNext);
  const notifyNewEpisodes = usePrefsStore((s) => s.notifyNewEpisodes);
  const setTheme = usePrefsStore((s) => s.setTheme);
  const setAutoNext = usePrefsStore((s) => s.setAutoNext);
  const setNotifyNewEpisodes = usePrefsStore((s) => s.setNotifyNewEpisodes);

  const isAdmin = useAuthStore((s) => s.identity?.is_admin ?? false);
  const queryClient = useQueryClient();
  const { data: config } = useSiteConfig();
  const currentBadgeDays = config?.new_badge_days ?? DEFAULT_NEW_BADGE_DAYS;
  const [accessCode, setAccessCode] = useState('');
  const [badgeDays, setBadgeDays] = useState('');
  const [busy, setBusy] = useState(false);

  const submitAccessCode = async () => {
    const code = accessCode.trim();
    if (!code || busy) return;
    setBusy(true);
    try {
      await post('/admin/access-code', { access_code: code });
      setAccessCode('');
      await dialog.alert('접근 인증번호가 변경되었습니다.');
    } catch (err) {
      await dialog.alert(err instanceof ApiError ? err.message : '변경에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const submitBadgeDays = async () => {
    const days = Number(badgeDays);
    if (busy) return;
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      await dialog.alert('기한은 1~365일 사이로 입력하세요.');
      return;
    }
    setBusy(true);
    try {
      await post('/admin/new-badge-days', { days });
      setBadgeDays('');
      await queryClient.invalidateQueries({ queryKey: ['config'] });
      await dialog.alert(`New 배지 기한이 ${days}일로 변경되었습니다.`);
    } catch (err) {
      await dialog.alert(err instanceof ApiError ? err.message : '변경에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

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

      {isAdmin && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>관리자</h3>
          <div className={styles.adminRow}>
            <span className={styles.adminLabel}>접근 인증번호</span>
            <input
              type="text"
              className={styles.adminInput}
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              placeholder="새 인증번호"
              autoComplete="off"
            />
            <button
              type="button"
              className={styles.adminBtn}
              disabled={busy || !accessCode.trim()}
              onClick={submitAccessCode}
            >
              변경
            </button>
          </div>
          <div className={styles.adminRow}>
            <span className={styles.adminLabel}>New 배지 기한</span>
            <input
              type="number"
              className={styles.adminInput}
              value={badgeDays}
              min={1}
              max={365}
              onChange={(e) => setBadgeDays(e.target.value)}
              placeholder={`현재 ${currentBadgeDays}일`}
            />
            <button
              type="button"
              className={styles.adminBtn}
              disabled={busy || !badgeDays.trim()}
              onClick={submitBadgeDays}
            >
              변경
            </button>
          </div>
          <p className={styles.hint}>
            New 배지 기한(1~365일)과 접근 인증번호는 서버에 저장되어 모든 사용자에게 적용됩니다.
          </p>
        </section>
      )}
    </Modal>
  );
}
