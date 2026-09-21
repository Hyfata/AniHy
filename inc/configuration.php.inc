<?php
// AniHy encoding configuration — template.
// Copy this file to configuration.php (same directory) and edit the values.
// configuration.php는 .gitignore라 레포에 없음 (머신별 설정: 인코딩 하드웨어, 병렬 수).
return [
    // 인코딩 하드웨어: software | intel | radeon | nvidia
    //  software: CPU libx264 (어디서든 동작, 느림)
    //  intel:    Intel iGPU VA-API (h264_vaapi, LIBVA_DRIVER_NAME=iHD)
    //  radeon:   AMD GPU VA-API (h264_vaapi, LIBVA_DRIVER_NAME=radeonsi)
    //  nvidia:   NVIDIA GPU NVENC (h264_nvenc)
    'encoder' => 'intel',

    // 동시에 돌릴 인코딩(워커) 수. 30초 idle 시 매니저가 종료되고
    // 다음 job 등록 때 새 매니저가 뜨므로, 값 변경은 늦어도 다음 매니저부터 반영됨.
    // (실행 중인 매니저도 매 루프마다 다시 읽어 hot-reload됨)
    // 권장: VA-API(순차) 1, NVENC 2~4.
    'max_workers' => 1,

    // VA-API 렌더 노드 (intel/radeon에서만 사용)
    'vaapi_device' => '/dev/dri/renderD128',

    // 화질: intel/radeon은 -qp, software는 -crf, nvidia는 -cq 값으로 사용 (0~51, 낮을수록 고화질)
    'quality' => 23,
];
