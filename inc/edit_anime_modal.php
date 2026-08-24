<?php // 관리자 전용. isAdmin() 체크 후 include 할 것. ?>
<div class="modal-overlay" id="edit-anime-modal">
    <div class="modal">
        <div class="modal-header">
            <h2>애니 정보 수정</h2>
            <button class="modal-close" onclick="closeModal('edit-anime-modal')">&times;</button>
        </div>
        <div class="modal-body">
            <form id="edit-anime-form" enctype="multipart/form-data">
                <input type="hidden" id="edit-id" name="id">
                <div class="form-group">
                    <label>현재 커버</label>
                    <img id="edit-cover-preview" src="" alt="" style="width:120px;border-radius:8px;">
                </div>
                <div class="form-group">
                    <label for="edit-title">애니 제목</label>
                    <input type="text" id="edit-title" name="title" required>
                </div>
                <div class="form-group">
                    <label for="edit-cover">새 커버 이미지 (변경 시에만 선택)</label>
                    <input type="file" id="edit-cover" name="cover" accept="image/*">
                </div>
                <div class="form-group">
                    <label for="edit-description">설명</label>
                    <textarea id="edit-description" name="description"></textarea>
                </div>
                <div class="form-group">
                    <label for="edit-is-hidive">서비스</label>
                    <select id="edit-is-hidive" name="is_hidive">
                        <option value="0">Crunchyroll</option>
                        <option value="1">Hidive</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>방영 분기</label>
                    <div class="broadcast-list" id="edit-broadcast-list"></div>
                    <button type="button" class="btn btn-secondary btn-sm add-broadcast-btn" data-target="edit-broadcast-list">분기 추가</button>
                </div>
                <div class="form-group">
                    <label for="edit-broadcast-day">방영 요일</label>
                    <select id="edit-broadcast-day" name="broadcast_day">
                        <option value="">선택 안 함</option>
                        <option>월</option>
                        <option>화</option>
                        <option>수</option>
                        <option>목</option>
                        <option>금</option>
                        <option>토</option>
                        <option>일</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="edit-download-url">애니 다운로드 주소</label>
                    <input type="url" id="edit-download-url" name="download_url" placeholder="https://...">
                </div>
                <div class="form-group">
                    <label for="edit-namuwiki-url">나무위키 주소</label>
                    <input type="url" id="edit-namuwiki-url" name="namuwiki_url" placeholder="https://namu.wiki/...">
                </div>

                <div class="form-group">
                    <label for="edit-search-keyword">시즌 검색</label>
                    <div style="display:flex;gap:8px">
                        <input type="text" id="edit-search-keyword" name="keyword" placeholder="예: one piece" style="flex:1">
                        <button type="button" id="edit-search-btn" class="btn btn-primary">검색</button>
                    </div>
                </div>

                <div class="form-group">
                    <label>검색 결과</label>
                    <div class="search-result" id="edit-search-result">검색 결과가 여기에 표시됩니다.</div>
                </div>

                <div class="form-group">
                    <label for="edit-season-id">시즌 ID</label>
                    <input type="text" id="edit-season-id" name="season_id" placeholder="예: GS0012345678">
                </div>
                <button type="submit" class="btn btn-primary" style="width:100%">수정</button>
            </form>
        </div>
    </div>
</div>
