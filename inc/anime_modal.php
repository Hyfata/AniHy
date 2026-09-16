<?php
// 애니 상세 모달 셸 (내용은 iframe으로 /anime/anime.php?aid=..&embed=1 로드)
?>
<div class="modal-overlay" id="anime-modal">
    <div class="modal anime-modal">
        <button type="button" class="modal-close anime-modal-close" onclick="closeAnimeModal()" aria-label="닫기">&times;</button>
        <iframe id="anime-modal-frame" class="anime-modal-frame" title="애니 상세"></iframe>
    </div>
</div>
