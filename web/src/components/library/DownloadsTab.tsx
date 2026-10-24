import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { formatBytes, relativeTime } from '../../lib/format';
import {
  deleteAllDownloads,
  deleteAnimeDownloads,
  isNative,
  listDownloads,
} from '../../lib/native';
import type { DownloadedAnime } from '../../lib/native';
import { useConnectivityStore } from '../../stores/connectivity';
import { useDownloadsStore } from '../../stores/downloads';
import { Skeleton } from '../Spinner';
import styles from './library.module.css';
import { dialog } from '../../stores/dialog';

/** 보관함 > 다운로드 — 오프라인 저장본은 네이티브(Tauri) 앱 전용.
   웹에서는 안내 카드만 표시하고, 네이티브에서는 애니 카드 목록으로 렌더한다.
   오프라인이면 카드를 펼쳐 저장 회차로 바로 재생(/watch)할 수 있다. */
export function DownloadsTab() {
  const [items, setItems] = useState<DownloadedAnime[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const online = useConnectivityStore((s) => s.online);
  const refreshStore = useDownloadsStore((s) => s.refresh);

  const reload = () => {
    if (!isNative()) return;
    listDownloads()
      .then((list) => {
        setItems(list);
        void refreshStore();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isNative()) {
    return (
      <div className={styles.infoCard}>
        <p className={styles.infoCardTitle}>오프라인 다운로드는 앱 전용 기능입니다</p>
        <p className={styles.infoCardBody}>
          에피소드를 기기에 저장해 오프라인에서 재생하는 기능은 네이티브 앱에서만 지원됩니다.
          앱에서 보관함 &gt; 다운로드 탭을 열어 저장한 회차를 관리하고 재생할 수 있습니다.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.infoCard}>
        <p className={styles.infoCardTitle}>저장본을 불러올 수 없습니다</p>
        <p className={styles.infoCardBody}>{error}</p>
      </div>
    );
  }

  if (items === null) {
    return (
      <div className={styles.historyList}>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} height={96} style={{ borderRadius: 'var(--radius)' }} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>저장된 회차가 없습니다</p>
        <p className={styles.emptyDesc}>애니 페이지에서 회차를 다운로드하면 여기에 표시됩니다.</p>
      </div>
    );
  }

  const removeAnime = (a: DownloadedAnime) => {
    void (async () => {
      if (!(await dialog.confirm(`'${a.title}' 저장본 ${a.episodes.length}개 회차를 삭제할까요?`, { confirmLabel: '삭제', danger: true }))) return;
      void deleteAnimeDownloads(a.animeId).then(reload);
    })();
  };

  const removeAll = () => {
    void (async () => {
      if (!(await dialog.confirm('저장본 전체를 삭제할까요?', { confirmLabel: '전체 삭제', danger: true }))) return;
      void deleteAllDownloads().then(reload);
    })();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-3)' }}>
        <button type="button" className={styles.historyDeleteBtn} onClick={removeAll}>
          저장본 전체 삭제
        </button>
      </div>
      <div className={styles.historyList}>
        {items.map((a) => (
          <div key={a.animeId}>
            <div
              className={styles.historyRow}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (online) {
                  navigate(`/anime/${a.animeId}`, { state: { background: location } });
                } else {
                  setExpanded(expanded === a.animeId ? null : a.animeId);
                }
              }}
            >
              <div className={styles.historyThumbWrap}>
                {a.cover ? <img src={a.cover} alt="" loading="lazy" /> : null}
              </div>
              <div className={styles.historyBody}>
                <h3 className={styles.historyTitle}>{a.title}</h3>
                <p className={styles.historyEp}>
                  {a.episodes.length}개 회차 · {formatBytes(a.totalSize)}
                  {!online && ' · 탭하여 회차 목록'}
                </p>
                <div className={styles.historyMeta}>
                  {a.episodes[0] && (
                    <span>최근 저장 {relativeTime(new Date(a.episodes[0].downloadedAt).toISOString())}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className={styles.historyDeleteBtn}
                aria-label="저장본 삭제"
                title="저장본 삭제"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAnime(a);
                }}
              >
                ×
              </button>
            </div>
            {expanded === a.animeId && (
              <div className={styles.historyList} style={{ marginTop: 'var(--space-2)' }}>
                {a.episodes.map((e) => (
                  <Link
                    key={e.episodeNumber}
                    to={`/watch/${a.animeId}/${encodeURIComponent(e.episodeNumber)}`}
                    className={styles.historyRow}
                  >
                    <div className={styles.historyBody}>
                      <h3 className={styles.historyTitle}>
                        {e.episodeNumber}화{e.title ? ` | ${e.title}` : ''}
                      </h3>
                      <p className={styles.historyEp}>{formatBytes(e.sizeBytes)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
