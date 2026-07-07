<div class="modal-overlay" id="queue-modal">
    <div class="modal modal-queue">
        <div class="modal-header">
            <h2>대기열</h2>
            <button class="modal-close" onclick="closeModal('queue-modal')">&times;</button>
        </div>
        <div class="modal-body">
            <div id="queue-groups-view">
                <div class="queue-empty" id="queue-empty">대기열이 비어 있습니다.</div>
                <div class="queue-list" id="queue-groups-list"></div>
            </div>

            <div id="queue-episodes-view" class="hidden">
                <div class="queue-back">
                    <button type="button" class="btn btn-sm" id="queue-back-to-groups">&larr; 애니 목록</button>
                </div>
                <h3 class="queue-anime-title" id="queue-episodes-title"></h3>
                <div class="queue-list" id="queue-episodes-list"></div>
            </div>

            <div id="queue-log-view" class="hidden">
                <div class="queue-back">
                    <button type="button" class="btn btn-sm" id="queue-back-to-episodes">&larr; 에피소드 목록</button>
                </div>
                <h3 class="queue-anime-title" id="queue-log-title"></h3>
                <div class="queue-progress-wrap">
                    <div class="queue-progress-label">전체 진행</div>
                    <div class="progress-bar">
                        <div class="progress-fill" id="queue-log-progress"></div>
                    </div>
                    <div class="queue-progress-label">인코딩 진행</div>
                    <div class="progress-bar">
                        <div class="progress-fill progress-fill-encode" id="queue-log-encode-progress"></div>
                    </div>
                    <div class="queue-log-status" id="queue-log-status"></div>
                </div>
                <div class="log-box" id="queue-log-box"></div>
            </div>
        </div>
    </div>
</div>
