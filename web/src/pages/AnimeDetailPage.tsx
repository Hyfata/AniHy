import { useParams } from 'react-router-dom';
import { AnimeDetailView } from '../components/anime/AnimeDetailView';

/** /anime/:id 직접 진입(새로고침·딥링크)용 전체 페이지.
   목록에서의 진입은 AnimeDetailModal(라우트 모달)이 위에 덮는다. */
export function AnimeDetailPage() {
  const { id } = useParams();
  const animeId = Number(id);

  return (
    <div className="container" style={{ paddingBottom: 40 }}>
      <AnimeDetailView animeId={animeId} />
    </div>
  );
}
