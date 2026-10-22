import { motion } from 'framer-motion';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { post } from '../api/client';
import { useAuthStore } from '../stores/auth';
import styles from './GatePage.module.css';

/** redirect 파라미터는 같은 오리진 경로만 허용 (open redirect 방지) */
function safeRedirect(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/';
}

export function GatePage() {
  const [params] = useSearchParams();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const fetchIdentity = useAuthStore((s) => s.fetchIdentity);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await post('/auth/gate', { code: code.trim() });
      await fetchIdentity();
      // 쿠키 발급 직후 SPA 라우팅 대신 전체 이동 — 미디어/스트리밍 요청도 쿠키를 실어 본낸다
      window.location.assign(safeRedirect(params.get('redirect')));
    } catch {
      setError('인증번호가 올바르지 않습니다.');
      setShakeKey((k) => k + 1);
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <motion.main
        key={shakeKey}
        className={`${styles.box}${shakeKey > 0 ? ` ${styles.shake}` : ''}`}
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      >
        <h1 className={styles.title}>AniHy</h1>
        <p className={styles.subtitle}>인증번호를 입력해주세요.</p>
        {error && <div className={styles.error}>{error}</div>}
        <form onSubmit={onSubmit}>
          <div className={styles.formGroup}>
            <label htmlFor="code">인증번호</label>
            <input
              id="code"
              type="text"
              className={styles.input}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
              autoComplete="off"
              inputMode="numeric"
            />
          </div>
          <button type="submit" className={styles.submit} disabled={submitting}>
            {submitting ? '확인 중…' : '확인'}
          </button>
        </form>
      </motion.main>
    </div>
  );
}
