import { useEffect, useState } from 'react';
import { api, del } from '../../api/client';
import type { AnimeDetail } from '../../api/types';
import { Modal } from '../Modal';
import { fetchText } from './utils';
import styles from './admin.module.css';

interface EditAnimeModalProps {
  open: boolean;
  onClose: () => void;
  /** null이면 생성 모드 (구 index.php #add-anime-modal) */
  anime: AnimeDetail | null;
  /** 저장 성공 후 (페이지가 상세를 다시 불러옴) */
  onSaved: () => void;
  /** 삭제 성공 후 (페이지가 목록으로 이동) — 수정 모드 전용 */
  onDeleted?: () => void;
}

interface BroadcastPair {
  year: string;
  quarter: string;
}

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

/** 애니 추가/수정 모달 (index.php #add-anime-modal + inc/edit_anime_modal.php 대응)
 *  생성: POST /api/admin/animes, 수정: PUT /api/admin/animes/{id} */
export function EditAnimeModal({ open, onClose, anime, onSaved, onDeleted }: EditAnimeModalProps) {
  const isCreate = anime === null;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [seasonId, setSeasonId] = useState('');
  const [isHidive, setIsHidive] = useState('0');
  const [broadcastDay, setBroadcastDay] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [namuwikiUrl, setNamuwikiUrl] = useState('');
  const [pairs, setPairs] = useState<BroadcastPair[]>([]);
  const [cover, setCover] = useState<File | null>(null);
  const [keyword, setKeyword] = useState('');
  const [searchResult, setSearchResult] = useState('');
  const [searching, setSearching] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(anime?.title ?? '');
    setDescription(anime?.description ?? '');
    setSeasonId(anime?.season_id ?? '');
    setIsHidive(anime?.is_hidive ? '1' : '0');
    setBroadcastDay(anime?.broadcast_day ?? '');
    setDownloadUrl(anime?.download_url ?? '');
    setNamuwikiUrl(anime?.namuwiki_url ?? '');
    setPairs(
      anime && anime.broadcasts.length > 0
        ? anime.broadcasts.map(([y, q]) => ({ year: String(y), quarter: String(q) }))
        : [{ year: '', quarter: '1' }],
    );
    setCover(null);
    setKeyword('');
    setSearchResult('');
    setErrors({});
  }, [open, anime]);

  const searchSeason = async () => {
    if (!keyword.trim()) return;
    setSearching(true);
    setSearchResult('검색 중...');
    try {
      const service = isHidive === '1' ? 'hidive' : 'crunchy';
      const text = await fetchText(
        `/anidown/search?keyword=${encodeURIComponent(keyword.trim())}&service=${service}`,
      );
      setSearchResult(text || '결과가 없습니다.');
    } catch (err) {
      setSearchResult(err instanceof Error ? err.message : '검색 중 오류가 발생했습니다.');
    } finally {
      setSearching(false);
    }
  };

  const submit = async () => {
    const nextErrors: Record<string, string> = {};
    if (!title.trim()) nextErrors.title = '제목을 입력하세요.';
    if (isCreate && !cover) nextErrors.cover = '커버 이미지를 업로드하세요.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('title', title.trim());
      fd.append('description', description);
      fd.append('season_id', seasonId.trim());
      fd.append('is_hidive', isHidive === '1' ? '1' : '');
      fd.append('broadcast_day', broadcastDay);
      fd.append('download_url', downloadUrl.trim());
      fd.append('namuwiki_url', namuwikiUrl.trim());
      for (const p of pairs) {
        if (!p.year.trim()) continue;
        fd.append('broadcast_year', p.year.trim());
        fd.append('broadcast_quarter', p.quarter);
      }
      if (cover) fd.append('cover', cover);
      if (isCreate) {
        await api('/admin/animes', { method: 'POST', formData: fd });
      } else {
        await api('/admin/animes/' + anime.id, { method: 'PUT', formData: fd });
      }
      onSaved();
      onClose();
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : '저장 실패' });
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    if (!anime || !onDeleted) return;
    if (!window.confirm('이 애니와 모든 에피소드를 삭제하시겠습니까?')) return;
    setDeleting(true);
    try {
      await del(`/admin/animes/${anime.id}`);
      onDeleted();
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : '삭제 실패' });
      setDeleting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isCreate ? '애니 추가' : '애니 정보 수정'}>
      {!isCreate && anime.cover && (
        <div className={styles.field}>
          <span className={styles.label}>현재 커버</span>
          <img className={styles.coverPreview} src={anime.cover} alt="" />
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="edit-anime-title">애니 제목</label>
        <input
          id="edit-anime-title"
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {errors.title && <div className={styles.error}>{errors.title}</div>}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="edit-anime-cover">
          {isCreate ? '커버 이미지 (세로 포스터 권장)' : '새 커버 이미지 (변경 시에만 선택)'}
        </label>
        <input
          id="edit-anime-cover"
          type="file"
          accept="image/*"
          onChange={(e) => setCover(e.target.files?.[0] ?? null)}
        />
        {errors.cover && <div className={styles.error}>{errors.cover}</div>}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="edit-anime-desc">설명</label>
        <textarea
          id="edit-anime-desc"
          className={styles.textarea}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="edit-anime-service">서비스</label>
        <select
          id="edit-anime-service"
          className={styles.select}
          value={isHidive}
          onChange={(e) => setIsHidive(e.target.value)}
        >
          <option value="0">Crunchyroll</option>
          <option value="1">Hidive</option>
        </select>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>방영 분기</span>
        {pairs.map((p, i) => (
          <div className={styles.broadcastRow} key={i}>
            <input
              className={styles.input}
              type="number"
              placeholder="연도"
              min={1900}
              max={2100}
              value={p.year}
              onChange={(e) =>
                setPairs(pairs.map((q, j) => (j === i ? { ...q, year: e.target.value } : q)))
              }
            />
            <select
              className={styles.select}
              value={p.quarter}
              onChange={(e) =>
                setPairs(pairs.map((q, j) => (j === i ? { ...q, quarter: e.target.value } : q)))
              }
            >
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={String(q)}>
                  {q}분기
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`}
              onClick={() => setPairs(pairs.filter((_, j) => j !== i))}
            >
              삭제
            </button>
          </div>
        ))}
        <button
          type="button"
          className={`${styles.btn} ${styles.btnSm}`}
          onClick={() => setPairs([...pairs, { year: '', quarter: '1' }])}
        >
          분기 추가
        </button>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="edit-anime-day">방영 요일</label>
        <select
          id="edit-anime-day"
          className={styles.select}
          value={broadcastDay}
          onChange={(e) => setBroadcastDay(e.target.value)}
        >
          <option value="">선택 안 함</option>
          {DAYS.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="edit-anime-dl-url">애니 다운로드 주소</label>
        <input
          id="edit-anime-dl-url"
          className={styles.input}
          type="url"
          placeholder="https://..."
          value={downloadUrl}
          onChange={(e) => setDownloadUrl(e.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="edit-anime-namu-url">나무위키 주소</label>
        <input
          id="edit-anime-namu-url"
          className={styles.input}
          type="url"
          placeholder="https://namu.wiki/..."
          value={namuwikiUrl}
          onChange={(e) => setNamuwikiUrl(e.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="edit-anime-keyword">시즌 검색</label>
        <div className={styles.row}>
          <input
            id="edit-anime-keyword"
            className={styles.input}
            placeholder="예: one piece"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void searchSeason();
              }
            }}
          />
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={searching}
            onClick={() => void searchSeason()}
          >
            검색
          </button>
        </div>
      </div>

      {searchResult && (
        <div className={styles.field}>
          <span className={styles.label}>검색 결과</span>
          <div className={styles.logBox}>{searchResult}</div>
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="edit-anime-season-id">시즌 ID</label>
        <input
          id="edit-anime-season-id"
          className={styles.input}
          placeholder="예: GS0012345678"
          value={seasonId}
          onChange={(e) => setSeasonId(e.target.value)}
        />
      </div>

      {errors.form && <div className={styles.error}>{errors.form}</div>}

      <div className={styles.footerRow}>
        {!isCreate && onDeleted && (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnDanger}`}
            disabled={deleting || submitting}
            onClick={() => void remove()}
          >
            {deleting ? '삭제 중...' : '삭제'}
          </button>
        )}
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={submitting || deleting}
          onClick={() => void submit()}
        >
          {submitting ? '저장 중...' : isCreate ? '추가' : '수정'}
        </button>
      </div>
    </Modal>
  );
}
