import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_BASE, api, get } from '../../api/client';
import type {
  AddJobResponse,
  AnimeDetail,
  AudioStream,
  ServerFileItem,
  SubtitleStream,
} from '../../api/types';
import { ServerFileList } from './ServerFileList';
import { fetchBlob, saveBlobAs } from './utils';
import { dialog } from '../../stores/dialog';
import styles from './admin.module.css';

type SourceTab = 'stream' | 'upload' | 'server';

interface AddEpisodeFormProps {
  anime: AnimeDetail;
  onClose: () => void;
  /** 대기열 추가 성공 후 */
  onAdded?: () => void;
  /** Shell modal footer container — the submit action is portaled into it so
     the fixed footer stays while this form's state remains local. */
  footerEl?: HTMLDivElement | null;
}

const VIDEO_EXTS = ['mkv', 'mp4', 'mov', 'avi', 'webm'];

/** 에피소드 단일 추가 폼 (anime.php #add-episode-modal 대응) — POST /api/jobs.
   EpisodeAddModal의 셸 안에서 렌더된다 (열림/리셋은 마운트 기준). */
export function AddEpisodeForm({ anime, onClose, onAdded, footerEl }: AddEpisodeFormProps) {
  const hasSeason = !!anime.season_id?.trim();
  const [tab, setTab] = useState<SourceTab>(hasSeason ? 'stream' : 'server');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // 공통 필드
  const [epNumber, setEpNumber] = useState('');
  const [epTitle, setEpTitle] = useState('');
  const [subFile, setSubFile] = useState<File | null>(null);
  const [trimEnabled, setTrimEnabled] = useState(false);
  const [trimSeconds, setTrimSeconds] = useState('7.5');
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [subOffset, setSubOffset] = useState('0');
  const [isTest, setIsTest] = useState(false);

  // 스트리밍 탭
  const [lookupLines, setLookupLines] = useState('');
  const [lookupRunning, setLookupRunning] = useState(false);
  const [lookupEps, setLookupEps] = useState<string[]>([]);
  const lookupRef = useRef<EventSource | null>(null);

  // 업로드 탭
  const [videoFile, setVideoFile] = useState<File | null>(null);

  // 서버 파일 탭
  const [serverFiles, setServerFiles] = useState<ServerFileItem[]>([]);
  const [serverListOpen, setServerListOpen] = useState(false);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverSelected, setServerSelected] = useState<number | null>(null);
  const [subTracks, setSubTracks] = useState<SubtitleStream[] | null>(null);
  const [subTrackIndex, setSubTrackIndex] = useState(0);
  const [attachedSub, setAttachedSub] = useState<File | null>(null);
  const [audioTracks, setAudioTracks] = useState<AudioStream[] | null>(null);
  const [audioIndex, setAudioIndex] = useState(0);
  const [extracting, setExtracting] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [enDownloading, setEnDownloading] = useState(false);

  const service = anime.is_hidive ? 'hidive' : 'crunchy';
  // 시즌 ID 없으면 스트리밍 탭 자체가 없으므로 stream 상태로 남아있으면 서버 파일로 간주
  const effTab: SourceTab = tab === 'stream' && !hasSeason ? 'server' : tab;

  const stopLookup = () => {
    lookupRef.current?.close();
    lookupRef.current = null;
    setLookupRunning(false);
  };

  useEffect(() => stopLookup, []);

  // ---------- 스트리밍 탭 ----------

  const startLookup = () => {
    const sid = anime.season_id?.trim();
    if (!sid) {
      setErrors((e) => ({ ...e, season: '시즌 ID가 없습니다. 애니 정보 수정에서 먼저 설정하세요.' }));
      return;
    }
    stopLookup();
    setLookupLines('에피소드 목록을 조회하는 중...\n');
    setLookupEps([]);
    setLookupRunning(true);

    const es = new EventSource(
      `${API_BASE}/anidown/episodes?season_id=${encodeURIComponent(sid)}&service=${service}`,
    );
    lookupRef.current = es;
    const found = new Set<string>();

    es.onmessage = (e) => {
      setLookupLines((prev) => prev + e.data + '\n');
      // aniDL 출력에서 회차 번호 추출 ("... E01 ..." / "Episode 1") — 칩으로 노출해 탭하면 회차 번호에 입력
      const m = e.data.match(/(?:episode\s+|e)(\d+(?:\.\d+)?)(?![\d.])/i);
      if (m && !found.has(m[1])) {
        found.add(m[1]);
        setLookupEps((prev) => [...prev, m[1]]);
      }
    };
    es.addEventListener('done', () => {
      setLookupLines((prev) => prev + '\n조회가 완료되었습니다.\n');
      stopLookup();
    });
    es.onerror = () => {
      setLookupLines((prev) => prev + '\n연결 중 오류가 발생했습니다. 관리자 권한이 있는지 확인하세요.\n');
      stopLookup();
    };
  };

  // ---------- 서버 파일 탭 ----------

  const selectedServerFile = serverSelected !== null ? serverFiles[serverSelected] : null;

  const loadServerFiles = async () => {
    if (serverListOpen) {
      setServerListOpen(false);
      return;
    }
    setServerListOpen(true);
    setServerLoading(true);
    try {
      const data = await get<{ ok: boolean; files: ServerFileItem[] }>('/server-files');
      setServerFiles(data.files ?? []);
    } catch (err) {
      setErrors((e) => ({
        ...e,
        server: err instanceof Error ? err.message : '목록을 불러올 수 없습니다.',
      }));
      setServerListOpen(false);
    } finally {
      setServerLoading(false);
    }
  };

  const pickServerFile = (index: number) => {
    setServerSelected(index);
    setServerListOpen(false);
    setSubTracks(null);
    setAttachedSub(null);
    setAudioTracks(null);
    setErrors((e) => {
      const { server: _drop, ...rest } = e;
      return rest;
    });
  };

  const clearServerFile = () => {
    setServerSelected(null);
    setSubTracks(null);
    setAttachedSub(null);
    setAudioTracks(null);
  };

  const listSubtitleTracks = async () => {
    if (!selectedServerFile) return;
    setExtracting(true);
    try {
      const data = await get<{ ok: boolean; streams: SubtitleStream[] }>(
        `/server-files/subtitles?path=${encodeURIComponent(selectedServerFile.path)}`,
      );
      const tracks = data.streams ?? [];
      if (tracks.length === 1) {
        await extractSubtitle(0);
      } else {
        setSubTracks(tracks);
        setSubTrackIndex(0);
      }
    } catch (err) {
      setErrors((e) => ({ ...e, subtitle: err instanceof Error ? err.message : '자막 확인 실패' }));
    } finally {
      setExtracting(false);
    }
  };

  const extractSubtitle = async (index: number) => {
    if (!selectedServerFile) return;
    setExtracting(true);
    setErrors((e) => {
      const { subtitle: _drop, ...rest } = e;
      return rest;
    });
    try {
      const { blob, filename } = await fetchBlob(
        `/server-files/subtitles/extract?path=${encodeURIComponent(selectedServerFile.path)}&index=${index}`,
      );
      const ext = filename.split('.').pop()?.toLowerCase() ?? '';
      if (ext !== 'ass' && ext !== 'smi') {
        // 이미지 자막(sup/mks)은 잡 파이프라인에 첨부 불가 — PHP처럼 다운로드만 제공
        saveBlobAs(blob, filename);
        setErrors((e) => ({
          ...e,
          subtitle: '이미지 자막은 인코딩에 첨부할 수 없어 파일로 다운로드했습니다.',
        }));
        return;
      }
      setAttachedSub(new File([blob], filename, { type: 'application/octet-stream' }));
      setSubTracks(null);
    } catch (err) {
      setErrors((e) => ({ ...e, subtitle: err instanceof Error ? err.message : '자막 추출 실패' }));
    } finally {
      setExtracting(false);
    }
  };

  /** 자막 트랙 추출 → 파일로 다운로드 (구 extract-subtitle-btn 동작) */
  const downloadSubtitle = async (index: number) => {
    if (!selectedServerFile) return;
    setExtracting(true);
    try {
      const { blob, filename } = await fetchBlob(
        `/server-files/subtitles/extract?path=${encodeURIComponent(selectedServerFile.path)}&index=${index}`,
      );
      saveBlobAs(blob, filename);
    } catch (err) {
      setErrors((e) => ({ ...e, subtitle: err instanceof Error ? err.message : '자막 추출 실패' }));
    } finally {
      setExtracting(false);
    }
  };

  const listAudioTracks = async () => {
    if (!selectedServerFile) return;
    setExtracting(true);
    try {
      const data = await get<{ ok: boolean; streams: AudioStream[]; selected: number }>(
        `/server-files/audio?path=${encodeURIComponent(selectedServerFile.path)}`,
      );
      const tracks = data.streams ?? [];
      if (tracks.length === 1) {
        await extractAudio(tracks[0].index);
      } else {
        setAudioTracks(tracks);
        setAudioIndex(data.selected ?? 0);
      }
    } catch (err) {
      setErrors((e) => ({ ...e, audio: err instanceof Error ? err.message : '오디오 확인 실패' }));
    } finally {
      setExtracting(false);
    }
  };

  const extractAudio = async (index: number) => {
    if (!selectedServerFile) return;
    setExtracting(true);
    try {
      const { blob, filename } = await fetchBlob(
        `/server-files/audio/extract?path=${encodeURIComponent(selectedServerFile.path)}&index=${index}`,
      );
      saveBlobAs(blob, filename);
      setAudioTracks(null);
    } catch (err) {
      setErrors((e) => ({ ...e, audio: err instanceof Error ? err.message : '오디오 추출 실패' }));
    } finally {
      setExtracting(false);
    }
  };

  // ---------- 영어 자막 다운로드 (구 download-en-subtitle-btn) ----------

  const downloadEnSubtitle = async () => {
    const ep = epNumber.trim();
    if (!ep) {
      setErrors((e) => ({ ...e, ep: '에피소드 번호를 입력하세요.' }));
      return;
    }
    setEnDownloading(true);
    try {
      const { blob } = await fetchBlob(
        `/downloads/en-subtitle?aid=${anime.id}&ep=${encodeURIComponent(ep)}`,
        { method: 'POST' },
      );
      saveBlobAs(blob, `${ep}_en.ass`);
    } catch (err) {
      setErrors((e) => ({
        ...e,
        enSub: err instanceof Error ? err.message : '영어 자막 다운로드 실패',
      }));
    } finally {
      setEnDownloading(false);
    }
  };

  // ---------- 제출 ----------

  const submit = async () => {
    const nextErrors: Record<string, string> = {};
    if (!epNumber.trim()) nextErrors.ep = '에피소드 번호를 입력하세요.';
    if (effTab === 'stream' && !anime.season_id?.trim())
      nextErrors.season = '시즌 ID가 없습니다. 애니 정보 수정에서 먼저 설정하세요.';
    if (effTab === 'upload') {
      if (!videoFile) nextErrors.video = '원본 영상 파일을 선택하세요.';
      else {
        const ext = videoFile.name.split('.').pop()?.toLowerCase() ?? '';
        if (!VIDEO_EXTS.includes(ext)) nextErrors.video = '지원하지 않는 영상 형식입니다. (mkv/mp4/mov/avi/webm)';
      }
    }
    if (effTab === 'server' && !selectedServerFile) nextErrors.server = '서버 파일을 선택하세요.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const hasSubtitle = effTab === 'server' ? !!(attachedSub ?? subFile) : !!subFile;
    if (!hasSubtitle) {
      const ok = await dialog.confirm(
        '자막 파일을 선택하지 않았습니다.\n기존 자막 재사용/내장 자막 추출이 시도되고, 둘 다 없으면 자막 없이 진행됩니다. 계속할까요?',
        { title: '자막 없음', confirmLabel: '계속' },
      );
      if (!ok) return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('anime_id', String(anime.id));
      fd.append('episode_number', epNumber.trim());
      fd.append('episode_title', epTitle.trim());
      if (trimEnabled) fd.append('trim_seconds', trimSeconds);
      if (syncEnabled) fd.append('subtitle_offset', subOffset);
      if (isTest) fd.append('is_test', '1');
      if (effTab === 'stream') {
        fd.append('season_id', anime.season_id!.trim());
        if (subFile) fd.append('subtitle', subFile);
      } else if (effTab === 'upload') {
        if (videoFile) fd.append('source_video', videoFile);
        if (subFile) fd.append('subtitle', subFile);
      } else if (selectedServerFile) {
        fd.append('server_video_path', selectedServerFile.path);
        const subtitle = attachedSub ?? subFile;
        if (subtitle) fd.append('subtitle', subtitle);
      }
      const res = await api<AddJobResponse>('/jobs', { method: 'POST', formData: fd });
      await dialog.alert(res.message || '대기열에 추가되었습니다.');
      stopLookup();
      onAdded?.();
      onClose();
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : '추가 실패' });
    } finally {
      setSubmitting(false);
    }
  };

  const submitLabel =
    effTab === 'upload' ? '업로드 및 변환' : effTab === 'server' ? '서버 파일 변환' : '다운로드 및 변환';

  const subtitleInput = (
    <div className={styles.field}>
      <label className={styles.label} htmlFor="add-ep-sub">자막 파일 (선택)</label>
      <input
        id="add-ep-sub"
        type="file"
        accept="*"
        onChange={(e) => setSubFile(e.target.files?.[0] ?? null)}
      />
    </div>
  );

  return (
    <>
      {footerEl &&
        createPortal(
          <>
            {errors.form && <div className={styles.error} style={{ marginBottom: 8 }}>{errors.form}</div>}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnBlock}`}
              disabled={submitting}
              onClick={() => void submit()}
            >
              {submitting ? '추가 중...' : submitLabel}
            </button>
          </>,
          footerEl,
        )}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="add-ep-number">에피소드 번호</label>
        <input
          id="add-ep-number"
          className={styles.input}
          placeholder="예: 1, 0, 0.5, OVA"
          value={epNumber}
          onChange={(e) => setEpNumber(e.target.value)}
        />
        {errors.ep && <div className={styles.error}>{errors.ep}</div>}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="add-ep-title">에피소드 제목 (선택)</label>
        <input
          id="add-ep-title"
          className={styles.input}
          value={epTitle}
          onChange={(e) => setEpTitle(e.target.value)}
        />
      </div>

      <div className={styles.sourceBox}>
        <div className={styles.tabs}>
          {(
            [
              ...(hasSeason ? [['stream', '스트리밍'] as [SourceTab, string]] : []),
              ['server', '서버 파일'],
              ['upload', '업로드'],
            ] as [SourceTab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`${styles.tab}${effTab === key ? ` ${styles.tabActive}` : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      {effTab === 'stream' && (
        <>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnBlock}`}
            disabled={lookupRunning}
            onClick={startLookup}
          >
            {lookupRunning ? '조회 중...' : '회차 조회'}
          </button>
          {errors.season && <div className={styles.error}>{errors.season}</div>}
          {lookupLines && (
            <>
              <div className={styles.logBox} style={{ marginTop: 8 }}>
                {lookupLines}
              </div>
              {lookupEps.length > 0 && (
                <div className={styles.epChips}>
                  {lookupEps.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={styles.epChip}
                      onClick={() => setEpNumber(n)}
                    >
                      {n}화
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <button
            type="button"
            className={`${styles.btn} ${styles.btnBlock}`}
            style={{ marginTop: 8 }}
            disabled={enDownloading}
            onClick={() => void downloadEnSubtitle()}
          >
            {enDownloading ? '영어 자막 다운로드 중...' : '영어 자막 다운로드'}
          </button>
          {errors.enSub && <div className={styles.error}>{errors.enSub}</div>}
        </>
      )}

      {effTab === 'upload' && (
        <div className={styles.field} style={{ marginBottom: 0 }}>
          <label className={styles.label} htmlFor="add-ep-video">원본 영상 파일 (mkv/mp4/mov/avi/webm)</label>
          <input
            id="add-ep-video"
            type="file"
            accept="video/*"
            onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
          />
          {errors.video && <div className={styles.error}>{errors.video}</div>}
        </div>
      )}

      {effTab === 'server' && (
        <div className={styles.field}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnBlock}`}
            onClick={() => void loadServerFiles()}
          >
            {serverListOpen ? '목록 닫기' : '서버 파일 선택'}
          </button>
          {errors.server && <div className={styles.error}>{errors.server}</div>}
          {serverListOpen && (
            <div style={{ marginTop: 8 }}>
              {serverLoading ? (
                <div className={styles.fileList}>불러오는 중...</div>
              ) : (
                <ServerFileList
                  files={serverFiles}
                  selected={serverSelected !== null ? new Set([serverSelected]) : new Set()}
                  onItemClick={(i) => pickServerFile(i)}
                />
              )}
            </div>
          )}
          {selectedServerFile && (
            <>
              <div className={styles.chip} style={{ marginTop: 8 }}>
                <span>{selectedServerFile.name}</span>
                <button type="button" onClick={clearServerFile} aria-label="선택 취소">
                  ×
                </button>
              </div>
              <div className={styles.footerRow}>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={extracting}
                  onClick={() => void listSubtitleTracks()}
                >
                  {extracting ? '확인 중...' : '자막 트랙'}
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={extracting}
                  onClick={() => void listAudioTracks()}
                >
                  오디오 추출
                </button>
              </div>
              {subTracks && (
                <div className={styles.field} style={{ marginTop: 8, marginBottom: 0 }}>
                  <div className={styles.row}>
                    <select
                      className={styles.select}
                      value={subTrackIndex}
                      onChange={(e) => setSubTrackIndex(Number(e.target.value))}
                    >
                      {subTracks.map((t) => (
                        <option key={t.index} value={t.index}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.footerRow}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      disabled={extracting}
                      onClick={() => void extractSubtitle(subTrackIndex)}
                    >
                      {extracting ? '추출 중...' : '추출해서 첨부'}
                    </button>
                    <button
                      type="button"
                      className={styles.btn}
                      disabled={extracting}
                      onClick={() => void downloadSubtitle(subTrackIndex)}
                    >
                      다운로드
                    </button>
                  </div>
                  <div className={styles.hint}>
                    {subTracks.length}개의 자막 트랙 — 첨부하면 이 작업의 자막으로, 다운로드는 파일로 저장합니다.
                  </div>
                </div>
              )}
              {audioTracks && (
                <div className={styles.field} style={{ marginTop: 8 }}>
                  <div className={styles.row}>
                    <select
                      className={styles.select}
                      value={audioIndex}
                      onChange={(e) => setAudioIndex(Number(e.target.value))}
                    >
                      {audioTracks.map((t) => (
                        <option key={t.index} value={t.index}>
                          #{t.index + 1} ({t.codec || 'unknown'}){t.language ? ` [${t.language}]` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      disabled={extracting}
                      onClick={() => void extractAudio(audioIndex)}
                    >
                      {extracting ? '추출 중...' : '다운로드'}
                    </button>
                  </div>
                </div>
              )}
              {attachedSub && (
                <div className={styles.chip} style={{ marginTop: 8 }}>
                  <span>자막 첨부됨: {attachedSub.name}</span>
                  <button type="button" onClick={() => setAttachedSub(null)} aria-label="자막 제거">
                    ×
                  </button>
                </div>
              )}
              {errors.subtitle && <div className={styles.error}>{errors.subtitle}</div>}
              {errors.audio && <div className={styles.error}>{errors.audio}</div>}
            </>
          )}
        </div>
      )}
      </div>

      {subtitleInput}

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
                id="add-ep-trim"
                type="checkbox"
                checked={trimEnabled}
                onChange={(e) => setTrimEnabled(e.target.checked)}
              />
              <label htmlFor="add-ep-trim">앞부분 자르기</label>
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
                id="add-ep-sync"
                type="checkbox"
                checked={syncEnabled}
                onChange={(e) => setSyncEnabled(e.target.checked)}
              />
              <label htmlFor="add-ep-sync">자막 싱크 조절 (초)</label>
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
            <div className={styles.checkboxRow} style={{ marginTop: 8 }}>
              <input
                id="add-ep-test"
                type="checkbox"
                checked={isTest}
                onChange={(e) => setIsTest(e.target.checked)}
              />
              <label htmlFor="add-ep-test">테스트 인코딩 (낮은 비트레이트·빠름, 자막 싱크 검증용)</label>
            </div>
          </>
        )}
      </div>
    </>
  );
}
