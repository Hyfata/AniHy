import type { ServerFileItem } from '../../api/types';
import styles from './admin.module.css';

interface ServerFileListProps {
  files: ServerFileItem[];
  /** 선택된 인덱스 집합 (단일 선택은 1개짜리 Set) */
  selected: ReadonlySet<number>;
  /** 범위 선택 앵커 (두 번째 탭 대기 중) */
  rangeAnchor?: number | null;
  onItemClick: (index: number, shiftKey: boolean) => void;
  emptyText?: string;
}

/** 서버 파일 목록 — 에피소드 추가(단일 선택)와 일괄 추가(다중/범위 선택)가 공용으로 사용 */
export function ServerFileList({
  files,
  selected,
  rangeAnchor = null,
  onItemClick,
  emptyText = '사용 가능한 서버 파일이 없습니다.',
}: ServerFileListProps) {
  if (files.length === 0) {
    return <div className={styles.fileList}>{emptyText}</div>;
  }
  return (
    <div className={styles.fileList}>
      {files.map((file, index) => {
        const cls = [
          styles.fileItem,
          selected.has(index) ? styles.fileItemSelected : '',
          rangeAnchor === index ? styles.fileItemAnchor : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div
            key={file.path}
            className={cls}
            role="button"
            tabIndex={0}
            onClick={(e) => onItemClick(index, e.shiftKey)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onItemClick(index, e.shiftKey);
              }
            }}
          >
            <div className={styles.fileName}>{file.name}</div>
            <div className={styles.fileDir}>{file.relative_dir}</div>
          </div>
        );
      })}
    </div>
  );
}
