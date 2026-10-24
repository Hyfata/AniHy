import { useEffect, useState } from 'react';
import { api, get } from '../../api/client';
import type { AddJobResponse, AnimeDetail, ServerFileItem } from '../../api/types';
import { Modal } from '../Modal';
import { ServerFileList } from './ServerFileList';
import { nameSort } from './utils';
import { dialog } from '../../stores/dialog';
import styles from './admin.module.css';

type BulkTab = 'stream' | 'server' | 'upload';

type BulkPayload =
  | { type: 'stream'; sub: File | null }
  | { type: 'server'; path: string; sub: File | null }
  | { type: 'upload'; file: File; sub: File | null };

interface BulkRow {
  key: number;
  ep: string;
  title: string;
  sourceLabel: string;
  subLabel: string | null;
  payload: BulkPayload;
}

interface BulkAddModalProps {
  open: boolean;
  onClose: () => void;
  anime: AnimeDetail;
  onAdded?: () => void;
}

/** 에피소드 일괄 추가 모달 (anime.php #bulk-add-modal 대응) — 회차별 순차 POST /api/jobs */
export function BulkAddModal({ open, onClose, anime, onAdded }: BulkAddModalProps) {
  const hasSeason = !!anime.season_id?.trim();
  const [tab, setTab] = useState<BulkTab>(hasSeason ? 'stream' : 'server');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // 스트리밍 범위
  const [streamStart, setStreamStart] = useState('1');
  const [streamEnd, setStreamEnd] = useState('12');

  // 서버 파일
  const [serverFiles, setServerFiles] = useState<ServerFileItem[]>([]);
  const [serverListOpen, setServerListOpen] = useState(false);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverSelected, setServerSelected] = useState<Set<number>>(new Set());
  const [serverLastIndex, setServerLastIndex] = useState<number | null>(null);
  const [rangeMode, setRangeMode] = useState(false);
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null);

  // 업로드
  const [videos, setVideos] = useState<File[]>([]);
  const [subs, setSubs] = useState<File[]>([]);

  // 공통
  const [startNumber, setStartNumber] = useState('1');
  const [trimEnabled, setTrimEnabled] = useState(false);
  const [trimSeconds, setTrimSeconds] = useState('7.5');
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [subOffset, setSubOffset] = useState('0');

  const [rows, setRows] = useState<BulkRow[] | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState('');

  useEffect(() => {
    if (!open) return;
    setTab(anime.season_id?.trim() ? 'stream' : 'server');
    setRows(null);
    setError('');
    setProgress('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anime.id]);

  const loadServerFiles = async () => {
    if (serverListOpen) {
      setServerListOpen(false);
      return;
    }
    setServerListOpen(true);
    setServerLoading(true);
    setError('');
    try {
      const data = await get<{ ok: boolean; files: ServerFileItem[] }>('/server-files');
      setServerFiles(data.files ?? []);
      setServerSelected(new Set());
      setServerLastIndex(null);
      setRangeMode(false);
      setRangeAnchor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '목록을 불러올 수 없습니다.');
      setServerListOpen(false);
    } finally {
      setServerLoading(false);
    }
  };

  const setRange = (from: number, to: number, select: boolean) => {
    const [lo, hi] = from < to ? [from, to] : [to, from];
    setServerSelected((prev) => {
      const next = new Set(prev);
      for (let i = lo; i <= hi; i++) {
        if (select) next.add(i);
        else next.delete(i);
      }
      return next;
    });
  };

  const onServerItemClick = (index: number, shiftKey: boolean) => {
    if (rangeMode) {
      // 모바일용 범위 선택: 탭 두 번 (앵커 → 끝점)
      if (rangeAnchor === null) {
        setRangeAnchor(index);
      } else {
        setRange(rangeAnchor, index, true);
        setRangeAnchor(null);
        setRangeMode(false);
      }
    } else if (shiftKey && serverLastIndex !== null) {
      setRange(serverLastIndex, index, !serverSelected.has(index));
    } else {
      setServerSelected((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
    }
    setServerLastIndex(index);
  };

  const subWarning = (videoCount: number, subCount: number): string | null => {
    if (subCount === 0 || videoCount === 0 || subCount === videoCount) return null;
    return subCount > videoCount
      ? `자막이 영상보다 ${subCount - videoCount}개 많습니다. 뒤쪽 자막은 무시됩니다.`
      : `자막이 영상보다 ${videoCount - subCount}개 적습니다. 나머지 회차는 자막 없이 진행됩니다.`;
  };

  // 시즌 ID 없으면 스트리밍 탭 자체가 없으므로 stream 상태로 남아있으면 서버 파일로 간주
  const effTab: BulkTab = tab === 'stream' && !hasSeason ? 'server' : tab;

  const buildPreview = () => {
    setError('');
    let seq = 0;
    const nextRows: BulkRow[] = [];
    const push = (
      ep: string,
      sourceLabel: string,
      subLabel: string | null,
      payload: BulkPayload,
    ) => nextRows.push({ key: seq++, ep, title: '', sourceLabel, subLabel, payload });

    if (effTab === 'stream') {
      const start = parseInt(streamStart, 10);
      const end = parseInt(streamEnd, 10);
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end - start > 100) {
        setError('회차 범위를 확인하세요. (시작 ≤ 끝, 최대 100개)');
        return;
      }
      const sortedSubs = [...subs].sort(nameSort);
      for (let ep = start; ep <= end; ep++) {
        const sub = sortedSubs[ep - start] ?? null;
        push(String(ep), '스트리밍 다운로드', sub ? sub.name : '없음', { type: 'stream', sub });
      }
    } else if (effTab === 'server') {
      if (serverSelected.size === 0) {
        setError('서버 파일을 선택하세요.');
        return;
      }
      let ep = parseInt(startNumber, 10);
      if (Number.isNaN(ep)) ep = 1;
      const files = [...serverSelected]
        .sort((a, b) => a - b)
        .map((i) => serverFiles[i])
        .sort((a, b) => a.path.localeCompare(b.path, 'ko', { numeric: true }));
      const sortedSubs = [...subs].sort(nameSort);
      files.forEach((file, i) => {
        const sub = sortedSubs[i] ?? null;
        push(String(ep++), file.name, sub ? sub.name : '없음', {
          type: 'server',
          path: file.path,
          sub,
        });
      });
    } else {
      if (videos.length === 0) {
        setError('원본 영상 파일을 선택하세요.');
        return;
      }
      let ep = parseInt(startNumber, 10);
      if (Number.isNaN(ep)) ep = 1;
      const sortedVideos = [...videos].sort(nameSort);
      const sortedSubs = [...subs].sort(nameSort);
      sortedVideos.forEach((file, i) => {
        const sub = sortedSubs[i] ?? null;
        push(String(ep++), file.name, sub ? sub.name : '없음', {
          type: 'upload',
          file,
          sub,
        });
      });
    }
    setRows(nextRows);
  };

  const submit = async () => {
    if (!rows || rows.length === 0 || submitting) return;
    setSubmitting(true);
    const failures: string[] = [];
    let succeeded = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const ep = row.ep.trim();
      if (ep === '') {
        failures.push(`${row.sourceLabel}: 회차 번호가 비어 있습니다.`);
        continue;
      }
      setProgress(`${i + 1}/${rows.length} 추가 중... (${ep}화)`);
      const fd = new FormData();
      fd.append('anime_id', String(anime.id));
      fd.append('episode_number', ep);
      fd.append('episode_title', row.title.trim());
      if (trimEnabled) fd.append('trim_seconds', trimSeconds);
      if (syncEnabled) fd.append('subtitle_offset', subOffset);
      if (row.payload.type === 'stream') {
        if (row.payload.sub) fd.append('subtitle', row.payload.sub);
      } else if (row.payload.type === 'upload') {
        fd.append('source_video', row.payload.file);
        if (row.payload.sub) fd.append('subtitle', row.payload.sub);
      } else if (row.payload.type === 'server') {
        fd.append('server_video_path', row.payload.path);
        if (row.payload.sub) fd.append('subtitle', row.payload.sub);
      }
      try {
        await api<AddJobResponse>('/jobs', { method: 'POST', formData: fd });
        succeeded++;
      } catch (err) {
        failures.push(`${ep}화: ${err instanceof Error ? err.message : '추가 실패'}`);
      }
    }
    setProgress('');
    setSubmitting(false);
    let msg = `${succeeded}개 에피소드를 대기열에 추가했습니다.`;
    if (failures.length > 0) msg += '\n\n실패:\n' + failures.join('\n');
    await dialog.alert(msg);
    if (succeeded > 0) {
      onAdded?.();
      onClose();
    }
  };

  const rangeCount = (() => {
    const start = parseInt(streamStart, 10);
    const end = parseInt(streamEnd, 10);
    return Number.isNaN(start) || Number.isNaN(end) || start > end ? 0 : end - start + 1;
  })();
  const currentWarning =
    effTab === 'server'
      ? subWarning(serverSelected.size, subs.length)
      : effTab === 'upload'
        ? subWarning(videos.length, subs.length)
        : subWarning(rangeCount, subs.length);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="에피소드 일괄 추가"
      footer={
        <>
          {error && <div className={styles.error} style={{ marginBottom: 8 }}>{error}</div>}
          {rows === null ? (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnBlock}`}
              onClick={buildPreview}
              disabled={submitting}
            >
              매핑 확인
            </button>
          ) : (
            <>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary} ${styles.btnBlock}`}
                disabled={submitting || rows.length === 0}
                onClick={() => void submit()}
              >
                {submitting ? '추가 중...' : `${rows.length}개 에피소드 추가`}
              </button>
              {progress && <div className={styles.progressText}>{progress}</div>}
            </>
          )}
        </>
      }
    >
      <div className={styles.sourceBox}>
        <div className={styles.tabs}>
          {(
            [
              ...(hasSeason ? [['stream', '스트리밍'] as [BulkTab, string]] : []),
              ['server', '서버 파일'],
              ['upload', '업로드'],
            ] as [BulkTab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`${styles.tab}${effTab === key ? ` ${styles.tabActive}` : ''}`}
              onClick={() => {
                setTab(key);
                setRows(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>

      {effTab === 'stream' && (
        <div className={styles.field} style={{ marginBottom: 0 }}>
          <span className={styles.label}>회차 범위</span>
          <div className={styles.row}>
            <input
              className={styles.input}
              type="number"
              min="0"
              step="1"
              value={streamStart}
              onChange={(e) => setStreamStart(e.target.value)}
            />
            <span>~</span>
            <input
              className={styles.input}
              type="number"
              min="0"
              step="1"
              value={streamEnd}
              onChange={(e) => setStreamEnd(e.target.value)}
            />
          </div>
        </div>
      )}

      {effTab === 'server' && (
        <>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnBlock}`}
            onClick={() => void loadServerFiles()}
          >
            {serverListOpen ? '목록 닫기' : '서버 파일 선택'}
          </button>
          {serverListOpen && (
            <div style={{ marginTop: 8 }}>
              <div className={styles.fileToolbar}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSm}${rangeMode ? ` ${styles.btnPrimary}` : ''}`}
                  onClick={() => {
                    setRangeMode(!rangeMode);
                    setRangeAnchor(null);
                  }}
                >
                  범위 선택
                </button>
                <span>{serverSelected.size}개 선택됨</span>
              </div>
              {serverLoading ? (
                <div className={styles.fileList}>불러오는 중...</div>
              ) : (
                <ServerFileList
                  files={serverFiles}
                  selected={serverSelected}
                  rangeAnchor={rangeAnchor}
                  onItemClick={onServerItemClick}
                />
              )}
            </div>
          )}
        </>
      )}

      {effTab === 'upload' && (
        <>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="bulk-videos">원본 영상 파일들 (이름순 정렬됨)</label>
            <input
              id="bulk-videos"
              type="file"
              accept="video/*"
              multiple
              onChange={(e) => setVideos(Array.from(e.target.files ?? []))}
            />
          </div>
        </>
      )}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="bulk-subs">
          자막 파일들 (선택, 이름순으로 회차에 매핑)
        </label>
        <input
          id="bulk-subs"
          type="file"
          accept="*"
          multiple
          onChange={(e) => setSubs(Array.from(e.target.files ?? []))}
        />
      </div>

      {currentWarning && <div className={styles.warning}>{currentWarning}</div>}

      {effTab !== 'stream' && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="bulk-start">시작 회차 번호</label>
          <input
            id="bulk-start"
            className={styles.input}
            type="number"
            min="0"
            step="1"
            value={startNumber}
            onChange={(e) => setStartNumber(e.target.value)}
          />
        </div>
      )}

      <div className={styles.field}>
        <button
          type="button"
          className={styles.advancedToggle}
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
        >
          <svg
            className={`${styles.advancedIcon}${advancedOpen ? ` ${styles.advancedIconOpen}` : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
          세부 설정
        </button>
        {advancedOpen && (
          <>
            <div className={styles.checkboxRow}>
              <input
                id="bulk-trim"
                type="checkbox"
                checked={trimEnabled}
                onChange={(e) => setTrimEnabled(e.target.checked)}
              />
              <label htmlFor="bulk-trim">앞부분 자르기 (전체 적용)</label>
            </div>
            <div className={styles.trimRow}>
              <input
                className={styles.input}
                type="number"
                step="0.1"
                min="0"
                value={trimSeconds}
                disabled={!trimEnabled}
                onChange={(e) => setTrimSeconds(e.target.value)}
              />
            </div>
            <div className={styles.checkboxRow} style={{ marginTop: 8 }}>
              <input
                id="bulk-sync"
                type="checkbox"
                checked={syncEnabled}
                onChange={(e) => setSyncEnabled(e.target.checked)}
              />
              <label htmlFor="bulk-sync">자막 싱크 조절 (초, 전체 적용)</label>
            </div>
            <div className={styles.trimRow}>
              <input
                className={styles.input}
                type="number"
                step="any"
                value={subOffset}
                disabled={!syncEnabled}
                onChange={(e) => setSubOffset(e.target.value)}
              />
            </div>
          </>
        )}
      </div>

      {rows && (
        <div>
          {rows.map((row, i) => (
            <div className={styles.mappingRow} key={row.key}>
              <input
                className={`${styles.input} ${styles.mappingEp}`}
                value={row.ep}
                title="회차 번호"
                onChange={(e) =>
                  setRows(rows.map((r, j) => (j === i ? { ...r, ep: e.target.value } : r)))
                }
              />
              <div className={styles.mappingMain}>
                <input
                  className={styles.input}
                  placeholder="에피소드 제목 (선택)"
                  value={row.title}
                  onChange={(e) =>
                    setRows(rows.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)))
                  }
                />
                <div className={styles.mappingMeta}>
                  원본: {row.sourceLabel} · 자막: {row.subLabel ?? '없음 (내장 자막 추출/기존 자막 재사용)'}
                </div>
              </div>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
